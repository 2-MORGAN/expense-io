import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { IdempotencyKeyReused, InvalidIdempotencyKey, SubmitExpenseNote } from './SubmitExpenseNote'
import {
  DuplicateIdempotencyKey,
  type ExpenseNoteSubmissionRepository,
  type SubmittedExpenseNote,
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
    findByIdempotencyKey: vi.fn<ExpenseNoteSubmissionRepository['findByIdempotencyKey']>(async () => null),
  }
  const storage = {
    upload: vi.fn(async () => { order.push('upload') }),
    delete: vi.fn(async () => {}),
    read: vi.fn(),
    getSignedUrl: vi.fn(),
  }
  const service = new SubmitExpenseNote(repository, storage, () => noteId)
  const submit = (overrides: { idempotencyKey?: string | null; description?: string } = {}) => service.execute(userId, {
    amount: 42.5, expenseDate: '2026-10-01', description: overrides.description ?? 'Taxi',
    receipt: { data: Buffer.from('x'), mimeType: 'image/png', extension: '.png' },
    idempotencyKey: overrides.idempotencyKey,
  })
  return { repository, storage, submit, order }
}

describe('SubmitExpenseNote', () => {
  it('uploads the receipt first, under a tenant-prefixed opaque key, then creates the note once', async () => {
    const { repository, storage, submit, order } = setup()
    const { note, replayed } = await submit()
    expect(replayed).toBe(false)
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
    expect((await submit()).note).toEqual(committed)
    expect(storage.delete).not.toHaveBeenCalled()
  })

  it('keeps the object when the database cannot confirm whether the note exists', async () => {
    const { repository, storage, submit } = setup()
    repository.create.mockRejectedValue(new Error('db down'))
    repository.find.mockRejectedValue(new Error('still down'))
    await expect(submit()).rejects.toThrow('db down')
    expect(storage.delete).not.toHaveBeenCalled()
  })

  describe('Idempotency-Key', () => {
    const key = randomUUID()

    it('stores the key and the request fingerprint on the note', async () => {
      const { repository, submit } = setup()
      await submit({ idempotencyKey: key })
      expect(repository.create).toHaveBeenCalledWith(userId, expect.objectContaining({
        idempotency: { key, fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/) },
      }))
    })

    it('rejects a malformed key before touching storage or the database', async () => {
      const { repository, storage, submit } = setup()
      await expect(submit({ idempotencyKey: 'not-a-uuid' })).rejects.toBeInstanceOf(InvalidIdempotencyKey)
      expect(storage.upload).not.toHaveBeenCalled()
      expect(repository.create).not.toHaveBeenCalled()
    })

    it('replays the existing note without uploading again when the request is identical', async () => {
      const first = setup()
      await first.submit({ idempotencyKey: key })
      const stored = { ...row('receipts/x'), request_fingerprint: first.repository.create.mock.calls[0][1].idempotency!.fingerprint }

      const { repository, storage, submit } = setup()
      repository.findByIdempotencyKey.mockResolvedValue(stored)
      const result = await submit({ idempotencyKey: key })
      expect(result).toEqual({ note: stored, replayed: true })
      expect(storage.upload).not.toHaveBeenCalled()
      expect(repository.create).not.toHaveBeenCalled()
    })

    it('refuses a known key reused with a different request', async () => {
      const { repository, storage, submit } = setup()
      repository.findByIdempotencyKey.mockResolvedValue({ ...row('receipts/x'), request_fingerprint: 'another' })
      await expect(submit({ idempotencyKey: key })).rejects.toBeInstanceOf(IdempotencyKeyReused)
      expect(storage.upload).not.toHaveBeenCalled()
    })

    it('lets the winner of a concurrent request stand and removes the loser object', async () => {
      const first = setup()
      await first.submit({ idempotencyKey: key })
      const winner = { ...row('receipts/winner'), request_fingerprint: first.repository.create.mock.calls[0][1].idempotency!.fingerprint }

      const { repository, storage, submit } = setup()
      repository.create.mockRejectedValue(new DuplicateIdempotencyKey())
      repository.findByIdempotencyKey.mockResolvedValueOnce(null).mockResolvedValueOnce(winner)
      const result = await submit({ idempotencyKey: key })
      expect(result).toEqual({ note: winner, replayed: true })
      expect(storage.delete).toHaveBeenCalledWith(`receipts/${companyId}/${noteId}.png`)
    })

    it('does not deduplicate without the header', async () => {
      const { repository, submit } = setup()
      await submit()
      expect(repository.findByIdempotencyKey).not.toHaveBeenCalled()
      expect(repository.create).toHaveBeenCalledWith(userId, expect.objectContaining({ idempotency: undefined }))
    })
  })
})
