import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { SubmitExpenseNote } from './SubmitExpenseNote'
import type {
  ExpenseNoteSubmissionRepository,
  SubmittedExpenseNote,
} from '@/ports/ExpenseNoteSubmissionRepository'

const companyId = randomUUID()
const noteId = randomUUID()
const userId = randomUUID()

function row(receiptKey: string): SubmittedExpenseNote {
  return {
    id: noteId, user_id: userId, amount: '42.50', expense_date: '2026-10-01',
    description: 'Taxi', receipt_key: receiptKey, status: 'pending', created_at: new Date(),
  }
}

function setup() {
  const order: string[] = []
  const repository = {
    companyIdOf: vi.fn(async () => companyId),
    create: vi.fn<ExpenseNoteSubmissionRepository['create']>(async (_u, n) => { order.push('create'); return row(n.receiptKey) }),
    find: vi.fn<ExpenseNoteSubmissionRepository['find']>(async () => null),
  }
  const storage = {
    upload: vi.fn(async () => { order.push('upload') }),
    delete: vi.fn(async () => {}),
    read: vi.fn(),
    getSignedUrl: vi.fn(),
  }
  const service = new SubmitExpenseNote(repository, storage, () => noteId)
  const submit = () => service.execute(userId, {
    amount: 42.5, expenseDate: '2026-10-01', description: 'Taxi',
    receipt: { data: Buffer.from('x'), mimeType: 'image/png', extension: '.png' },
  })
  return { repository, storage, submit, order }
}

describe('SubmitExpenseNote', () => {
  it('uploads the receipt first, under a tenant-prefixed opaque key, then creates the note once', async () => {
    const { repository, storage, submit, order } = setup()
    const note = await submit()
    const key = `receipts/${companyId}/${noteId}.png`
    expect(order).toEqual(['upload', 'create'])
    expect(storage.upload).toHaveBeenCalledWith(key, expect.any(Buffer), 'image/png')
    expect(repository.create).toHaveBeenCalledWith(userId, expect.objectContaining({ id: noteId, receiptKey: key }))
    expect(note.receipt_key).toBe(key)
  })

  it('creates no note when the upload fails', async () => {
    const { repository, storage, submit } = setup()
    storage.upload.mockRejectedValue(new Error('s3 down'))
    await expect(submit()).rejects.toThrow('s3 down')
    expect(repository.create).not.toHaveBeenCalled()
    expect(storage.delete).not.toHaveBeenCalled()
  })

  it('removes the uploaded object when the transaction failed and the note does not exist', async () => {
    const { repository, storage, submit } = setup()
    repository.create.mockRejectedValue(new Error('db down'))
    await expect(submit()).rejects.toThrow('db down')
    expect(storage.delete).toHaveBeenCalledWith(`receipts/${companyId}/${noteId}.png`)
  })

  it('keeps the object and returns the note when the commit succeeded but its acknowledgement was lost', async () => {
    const { repository, storage, submit } = setup()
    repository.create.mockRejectedValue(new Error('connection lost after commit'))
    const committed = row(`receipts/${companyId}/${noteId}.png`)
    repository.find.mockResolvedValue(committed)
    expect(await submit()).toEqual(committed)
    expect(storage.delete).not.toHaveBeenCalled()
  })

  it('keeps the object when the database cannot confirm whether the note exists', async () => {
    const { repository, storage, submit } = setup()
    repository.create.mockRejectedValue(new Error('db down'))
    repository.find.mockRejectedValue(new Error('still down'))
    await expect(submit()).rejects.toThrow('db down')
    expect(storage.delete).not.toHaveBeenCalled()
  })
})
