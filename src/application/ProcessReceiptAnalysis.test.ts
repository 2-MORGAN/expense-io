import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { ProcessReceiptAnalysis, MAX_ANALYSIS_ATTEMPTS } from './ProcessReceiptAnalysis'
import { OcrCapacity } from './OcrCapacity'
import { SuggestReceiptFields } from './SuggestReceiptFields'
import { OcrError } from '@/domain/receipt/OcrError'
import { NonRetryableError, type OutboxEventRecord } from '@/ports/EventOutbox'
import type { AnalysisStart } from '@/ports/ReceiptAnalysisWorkPort'
import { pngReceipt } from '../../e2e/support/files'

function setup() {
  const analysisId = randomUUID(), companyId = randomUUID(), userId = randomUUID()
  const event: OutboxEventRecord = { id: randomUUID(), companyId, type: 'receipt.analysis.requested',
    payload: { version: 1, analysisId, companyId, userId, receiptKey: `receipts/${companyId}/analyses/${analysisId}` },
    attempts: 1, createdAt: new Date() }
  const work = {
    start: vi.fn(async (): Promise<AnalysisStart> => ({ kind: 'run', mimeType: 'image/png' })),
    finish: vi.fn(async () => true),
  }
  const storage = { upload: vi.fn(), read: vi.fn(async () => pngReceipt('job').buffer), delete: vi.fn(), getSignedUrl: vi.fn() }
  const recognize = vi.fn(async () => 'TOTAL TTC : 42,50 EUR')
  const suggest = new SuggestReceiptFields({ recognize, inspect: vi.fn() })
  const execution = { run: async <T>(_user: string, _signal: AbortSignal, task: () => Promise<T>) => task() }
  const handler = new ProcessReceiptAnalysis(work, storage, suggest, new OcrCapacity(), execution)
  return { event, work, storage, recognize, handler }
}

const signal = () => new AbortController().signal

describe('durable receipt analysis handler', () => {
  it('stores a successful result through the same suggestion use case', async () => {
    const { handler, event, work } = setup()
    await handler.execute(event, signal())
    expect(work.finish).toHaveBeenCalledWith(event, event.payload,
      { status: 'succeeded', result: { amount: 42.5, expenseDate: undefined, description: undefined } })
  })

  it('puts the analysis back in the queue and asks the worker to retry on an engine failure', async () => {
    const { handler, event, work, recognize } = setup()
    recognize.mockRejectedValue(new OcrError('OCR_UNAVAILABLE'))
    const error = await handler.execute(event, signal()).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(NonRetryableError)
    expect(work.finish).toHaveBeenCalledWith(event, event.payload, { status: 'queued' })
  })

  it('closes the analysis as failed on the last attempt, without a further retry', async () => {
    const { handler, event, work, recognize } = setup()
    event.attempts = MAX_ANALYSIS_ATTEMPTS
    recognize.mockRejectedValue(new OcrError('OCR_UNAVAILABLE'))
    await expect(handler.execute(event, signal())).rejects.toBeInstanceOf(NonRetryableError)
    expect(work.finish).toHaveBeenCalledWith(event, event.payload, { status: 'failed', errorCode: 'OCR_UNAVAILABLE' })
  })

  it('expires queued jobs without downloading or recognizing their receipt', async () => {
    const { handler, event, work, storage } = setup()
    event.createdAt = new Date(Date.now() - 61_000)
    await expect(handler.execute(event, signal())).rejects.toBeInstanceOf(NonRetryableError)
    expect(storage.read).not.toHaveBeenCalled()
    expect(work.finish).toHaveBeenCalledWith(event, event.payload, { status: 'failed', errorCode: 'OCR_TIMEOUT' })
  })

  it('refuses a payload pointing to another tenant receipt', async () => {
    const { handler, event, work, storage } = setup()
    event.payload = { ...event.payload, companyId: randomUUID() }
    await expect(handler.execute(event, signal())).rejects.toBeInstanceOf(NonRetryableError)
    expect(storage.read).not.toHaveBeenCalled()
    expect(work.finish).not.toHaveBeenCalled()
  })

  it('does nothing when a previous attempt already finished the analysis', async () => {
    const { handler, event, work, storage } = setup()
    work.start.mockResolvedValue({ kind: 'done' })
    await handler.execute(event, signal())
    expect(storage.read).not.toHaveBeenCalled()
    expect(work.finish).not.toHaveBeenCalled()
  })

  it('treats a stopped worker as a transient failure instead of leaving the analysis running', async () => {
    const { handler, event, work, recognize } = setup()
    const controller = new AbortController()
    // Comme TesseractOcrAdapter : le moteur s'arrête dès que le signal est déclenché.
    recognize.mockImplementation(async (...args: unknown[]) => {
      controller.abort()
      ;(args[1] as AbortSignal).throwIfAborted()
      return ''
    })
    await expect(handler.execute(event, controller.signal)).rejects.not.toBeInstanceOf(NonRetryableError)
    expect(work.finish).toHaveBeenCalledWith(event, event.payload, { status: 'queued' })
  })
})
