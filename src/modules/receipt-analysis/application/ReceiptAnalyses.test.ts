import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { ReceiptAnalyses } from './ReceiptAnalyses'
import { OcrError } from '@/modules/receipt-analysis/domain/OcrError'
import { pngReceipt } from '../../../../e2e/support/files'
import type { ReceiptAnalysisRepository, NewReceiptAnalysis, ReceiptAnalysis } from '@/ports/ReceiptAnalysisRepository'

function setup() {
  const actor = { userId: randomUUID(), companyId: randomUUID() }
  const repository = {
    actor: vi.fn(async () => actor),
    find: vi.fn<ReceiptAnalysisRepository['find']>(async () => null),
    replay: vi.fn<ReceiptAnalysisRepository['replay']>(async () => null),
    enqueue: vi.fn<ReceiptAnalysisRepository['enqueue']>(async (_actor, input: NewReceiptAnalysis) => ({ id: input.id, status: 'queued' as const })),
  }
  const storage = { upload: vi.fn(async () => {}), delete: vi.fn(async () => {}), read: vi.fn(), getSignedUrl: vi.fn() }
  const file = pngReceipt('launch')
  const service = new ReceiptAnalyses(repository, storage)
  const launch = () => service.launch(actor, { data: file.buffer, mimeType: file.mimeType }, null, new AbortController().signal)
  return { repository, storage, launch }
}

describe('durable analysis acceptance', () => {
  it('compensates an upload when the enqueue was rolled back', async () => {
    const { repository, storage, launch } = setup()
    repository.enqueue.mockRejectedValue(new OcrError('OCR_OVERLOADED'))
    await expect(launch()).rejects.toThrow('OCR_OVERLOADED')
    expect(storage.delete).toHaveBeenCalledOnce()
  })
  it('preserves an accepted job when the commit acknowledgement was lost', async () => {
    const { repository, storage, launch } = setup()
    repository.enqueue.mockRejectedValue(new Error('connection lost after commit'))
    const accepted: ReceiptAnalysis = { id: randomUUID(), status: 'queued' }
    repository.find.mockResolvedValue(accepted)
    expect(await launch()).toEqual(accepted)
    expect(storage.delete).not.toHaveBeenCalled()
  })
  it('preserves the source if the database cannot confirm whether commit succeeded', async () => {
    const { repository, storage, launch } = setup()
    repository.enqueue.mockRejectedValue(new Error('database unavailable'))
    repository.find.mockRejectedValue(new Error('still unavailable'))
    await expect(launch()).rejects.toThrow('database unavailable')
    expect(storage.delete).not.toHaveBeenCalled()
  })
  it('returns a replay without uploading the receipt again', async () => {
    const { repository, storage, launch } = setup()
    const accepted: ReceiptAnalysis = { id: randomUUID(), status: 'succeeded', result: { amount: 42.5 } }
    repository.replay.mockResolvedValue(accepted)
    expect(await launch()).toEqual(accepted)
    expect(storage.upload).not.toHaveBeenCalled()
    expect(repository.enqueue).not.toHaveBeenCalled()
  })
})
