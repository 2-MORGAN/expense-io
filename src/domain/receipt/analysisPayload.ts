import { OcrError } from './OcrError'
import type { OutboxEventRecord } from '@/ports/EventOutbox'
import type { AnalysisPayload } from '@/ports/ReceiptAnalysisWorkPort'

/** Type d'événement de l'outbox qui déclenche l'analyse d'un reçu. */
export const RECEIPT_ANALYSIS_REQUESTED = 'receipt.analysis.requested'

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function analysisPayload(event: OutboxEventRecord): AnalysisPayload {
  const input = event.payload as Partial<AnalysisPayload> | null
  if (!input || input.version !== 1 || typeof input.analysisId !== 'string' || !UUID.test(input.analysisId)
    || typeof input.userId !== 'string' || !UUID.test(input.userId) || input.companyId !== event.companyId
    || input.receiptKey !== `receipts/${event.companyId}/analyses/${input.analysisId}`) {
    throw new OcrError('VALIDATION_ERROR')
  }
  return input as AnalysisPayload
}
