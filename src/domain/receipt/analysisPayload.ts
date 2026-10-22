import { OcrError } from './OcrError'
import type { OutboxEvent } from '@/ports/OutboxPort'
import type { AnalysisPayload } from '@/ports/ReceiptAnalysisWorkPort'

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function analysisPayload(event: OutboxEvent): AnalysisPayload {
  const input = event.payload as Partial<AnalysisPayload> | null
  if (!input || input.version !== 1 || typeof input.analysisId !== 'string' || !UUID.test(input.analysisId)
    || typeof input.userId !== 'string' || !UUID.test(input.userId) || input.companyId !== event.companyId
    || input.receiptKey !== `receipts/${event.companyId}/analyses/${input.analysisId}`) {
    throw new OcrError('VALIDATION_ERROR')
  }
  return input as AnalysisPayload
}
