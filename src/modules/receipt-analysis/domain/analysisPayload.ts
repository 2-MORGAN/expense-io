import { OcrError } from './OcrError'
import { UUID } from '@/utils/uuid'
import type { OutboxEventRecord } from '@/ports/EventOutbox'
import type { AnalysisPayload } from '@/ports/ReceiptAnalysisWorkPort'

/** Type d'événement de l'outbox qui déclenche l'analyse d'un reçu. */
export const RECEIPT_ANALYSIS_REQUESTED = 'receipt.analysis.requested'

export { UUID } from '@/utils/uuid'

export function analysisPayload(event: OutboxEventRecord): AnalysisPayload {
  const input = event.payload as Partial<AnalysisPayload> | null
  if (!input || input.version !== 1 || typeof input.analysisId !== 'string' || !UUID.test(input.analysisId)
    || typeof input.userId !== 'string' || !UUID.test(input.userId) || input.companyId !== event.companyId
    || input.receiptKey !== `receipts/${event.companyId}/analyses/${input.analysisId}`) {
    throw new OcrError('VALIDATION_ERROR')
  }
  return input as AnalysisPayload
}
