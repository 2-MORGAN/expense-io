import type { OutboxEventRecord } from '@/ports/EventOutbox'
import type { ExpenseNoteSuggestion } from '@/modules/receipt-analysis/domain/parseReceiptText'
import type { OcrErrorCode } from '@/modules/receipt-analysis/domain/OcrError'

export interface AnalysisPayload {
  version: 1; analysisId: string; userId: string; companyId: string; receiptKey: string
}

/** Où en est l'analyse au moment où le worker la reprend. */
export type AnalysisStart =
  | { kind: 'run'; mimeType: string }
  /** Déjà terminée par un essai précédent : rien à refaire. */
  | { kind: 'done' }
  /** Introuvable, expirée ou prise en charge par un autre worker. */
  | { kind: 'missing' }

/** Issue d'un essai : `queued` remet l'analyse en attente d'une relance. */
export type AnalysisOutcome =
  | { status: 'succeeded'; result: ExpenseNoteSuggestion }
  | { status: 'queued' }
  | { status: 'failed'; errorCode: OcrErrorCode }

/**
 * Écritures de l'analyse, chacune dans sa propre transaction courte et
 * seulement si l'événement est toujours au même essai (sinon un autre worker
 * l'a repris : un consommateur périmé ne doit rien écrire).
 */
export interface ReceiptAnalysisWorkPort {
  start(event: OutboxEventRecord, payload: AnalysisPayload): Promise<AnalysisStart>
  finish(event: OutboxEventRecord, payload: AnalysisPayload, outcome: AnalysisOutcome): Promise<boolean>
}
