import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { ProcessReceiptAnalysis } from './ProcessReceiptAnalysis'
import { OcrCapacity } from './OcrCapacity'
import { SuggestReceiptFields } from './SuggestReceiptFields'
import { OcrError } from '@/domain/receipt/OcrError'
import type { OutboxEvent } from '@/ports/OutboxPort'
import { pngReceipt } from '../../e2e/support/files'

function setup() {
  const analysisId = randomUUID(), companyId = randomUUID(), userId = randomUUID()
  const event: OutboxEvent = { id: randomUUID(), companyId, type: 'receipt.analysis.requested',
    payload: { version: 1, analysisId, companyId, userId, receiptKey: `receipts/${companyId}/analyses/${analysisId}` },
    attempts: 1, leaseToken: randomUUID(), createdAt: new Date() }
  const work = { start: vi.fn(async () => 'image/png'), finish: vi.fn(async () => {}) }
  const storage = { upload: vi.fn(), read: vi.fn(async () => pngReceipt('job').buffer), delete: vi.fn(), getSignedUrl: vi.fn() }
  const recognize = vi.fn(async () => 'TOTAL TTC : 42,50 EUR')
  const suggest = new SuggestReceiptFields({ recognize, inspect: vi.fn() })
  const execution = { run: async <T>(_user: string, _signal: AbortSignal, task: () => Promise<T>) => task() }
  const handler = new ProcessReceiptAnalysis(work, storage, suggest, new OcrCapacity(), execution)
  return { event, work, storage, recognize, handler }
}

describe('durable receipt analysis handler', () => {
  it('stores a successful result through the same suggestion use case', async () => {
    const { handler, event, work } = setup()
    await handler.execute(event, new AbortController().signal)
    expect(work.finish).toHaveBeenCalledWith(event, event.payload, { amount: 42.5, expenseDate: undefined })
  })
  it('reports engine failures for retry instead of storing an empty success', async () => {
    const { handler, event, work, recognize } = setup()
    recognize.mockRejectedValue(new OcrError('OCR_UNAVAILABLE'))
    await handler.execute(event, new AbortController().signal)
    expect(work.finish).toHaveBeenCalledWith(event, event.payload, undefined, 'OCR_UNAVAILABLE')
  })
  it('expires queued jobs without downloading or recognizing their receipt', async () => {
    const { handler, event, work, storage } = setup()
    event.createdAt = new Date(Date.now() - 61_000)
    await handler.execute(event, new AbortController().signal)
    expect(storage.read).not.toHaveBeenCalled()
    expect(work.finish).toHaveBeenCalledWith(event, event.payload, undefined, 'OCR_TIMEOUT')
  })
  it('refuses a payload pointing to another tenant receipt', async () => {
    const { handler, event, work, storage } = setup()
    event.payload = { ...event.payload as object, companyId: randomUUID() }
    await handler.execute(event, new AbortController().signal)
    expect(storage.read).not.toHaveBeenCalled()
    expect(work.finish).toHaveBeenCalledWith(event, null, undefined, 'VALIDATION_ERROR')
  })
})
