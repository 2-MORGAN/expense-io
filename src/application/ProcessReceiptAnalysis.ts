import { OcrError } from '@/domain/receipt/OcrError'
import { ANALYSIS_QUEUE_TIMEOUT_MS, OCR_TIMEOUT_MS } from '@/domain/receipt/limits'
import type { OutboxEvent } from '@/ports/OutboxPort'
import type { ReceiptStoragePort } from '@/ports/ReceiptStoragePort'
import type { SuggestReceiptFields } from './SuggestReceiptFields'
import type { OcrCapacity } from './OcrCapacity'
import { analysisPayload } from '@/domain/receipt/analysisPayload'
import type { ReceiptAnalysisWorkPort } from '@/ports/ReceiptAnalysisWorkPort'
import type { OcrExecutionPort } from '@/ports/OcrExecutionPort'

export class ProcessReceiptAnalysis {
  constructor(
    private work: ReceiptAnalysisWorkPort,
    private storage: ReceiptStoragePort,
    private suggest: SuggestReceiptFields,
    private capacity: OcrCapacity,
    private execution: OcrExecutionPort,
  ) {}

  async execute(event: OutboxEvent, parent: AbortSignal) {
    let payload: ReturnType<typeof analysisPayload> | null = null
    let reservation: ReturnType<OcrCapacity['reserve']> | undefined
    try {
      payload = analysisPayload(event)
      const remaining = ANALYSIS_QUEUE_TIMEOUT_MS - (Date.now() - event.createdAt.getTime())
      if (remaining <= 0 || event.attempts > 3) throw new OcrError('OCR_TIMEOUT')
      reservation = this.capacity.reserve(parent, Math.min(OCR_TIMEOUT_MS, remaining))
      const mimeType = await this.work.start(event, payload)
      if (!mimeType) { await this.work.finish(event, payload, undefined, 'RESOURCE_NOT_FOUND'); return }
      const current = payload
      const result = await reservation.run(async (signal) => {
        const data = await this.storage.read(current.receiptKey, signal)
        return this.execution.run(current.userId, signal, () => this.suggest.execute({ data, mimeType }, signal))
      })
      await this.work.finish(event, payload, result)
    } catch (error) {
      if (parent.aborted) return // Bail conservé ; un autre worker reprendra après expiration.
      const code = error instanceof OcrError ? error.code : 'OCR_UNAVAILABLE'
      await this.work.finish(event, payload, undefined, code)
      console.error(JSON.stringify({ eventId: event.id, code, attempt: event.attempts }))
    } finally { reservation?.release() }
  }
}
