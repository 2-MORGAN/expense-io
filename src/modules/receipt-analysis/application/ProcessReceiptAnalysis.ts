import { OcrError, type OcrErrorCode } from '@/modules/receipt-analysis/domain/OcrError'
import { ANALYSIS_QUEUE_TIMEOUT_MS, OCR_TIMEOUT_MS } from '@/modules/receipt-analysis/domain/limits'
import { NonRetryableError, type OutboxEventRecord } from '@/ports/EventOutbox'
import type { ReceiptStoragePort } from '@/ports/ReceiptStoragePort'
import type { SuggestReceiptFields } from './SuggestReceiptFields'
import type { OcrCapacity } from './OcrCapacity'
import { analysisPayload } from '@/modules/receipt-analysis/domain/analysisPayload'
import type { AnalysisPayload, ReceiptAnalysisWorkPort } from '@/ports/ReceiptAnalysisWorkPort'
import type { OcrExecutionPort } from '@/ports/OcrExecutionPort'

/** Trois essais au plus (ADR-003 §2) ; le worker relance avec `ANALYSIS_BACKOFF_SECONDS`. */
export const MAX_ANALYSIS_ATTEMPTS = 3
/** L'utilisateur attend devant le formulaire : relances après 1 s puis 5 s. */
export const ANALYSIS_BACKOFF_SECONDS: readonly number[] = [1, 5]

const TRANSIENT_CODES: ReadonlySet<OcrErrorCode> = new Set(['OCR_TIMEOUT', 'OCR_UNAVAILABLE', 'OCR_OVERLOADED'])

/**
 * Traitement détaché de l'événement `receipt.analysis.requested` : il
 * s'exécute hors transaction (l'OCR peut durer jusqu'à 60 s) et enregistre
 * lui-même l'issue de l'analyse. Il décide de la relance : panne passagère
 * avec un essai et du budget restants → analyse remise en attente et exception
 * (le worker relance) ; sinon → analyse « failed » et `NonRetryableError`
 * (l'événement passe `dead`).
 */
export class ProcessReceiptAnalysis {
  constructor(
    private work: ReceiptAnalysisWorkPort,
    private storage: ReceiptStoragePort,
    private suggest: SuggestReceiptFields,
    private capacity: OcrCapacity,
    private execution: OcrExecutionPort,
  ) {}

  async execute(event: OutboxEventRecord, parent: AbortSignal): Promise<void> {
    let payload: AnalysisPayload
    try {
      payload = analysisPayload(event)
    } catch {
      throw new NonRetryableError('VALIDATION_ERROR')
    }

    let reservation: ReturnType<OcrCapacity['reserve']> | undefined
    try {
      const remaining = ANALYSIS_QUEUE_TIMEOUT_MS - (Date.now() - event.createdAt.getTime())
      if (remaining <= 0 || event.attempts > MAX_ANALYSIS_ATTEMPTS) throw new OcrError('OCR_TIMEOUT')
      reservation = this.capacity.reserve(parent, Math.min(OCR_TIMEOUT_MS, remaining))
      const start = await this.work.start(event, payload)
      if (start.kind === 'done') return
      if (start.kind === 'missing') {
        await this.work.finish(event, payload, { status: 'failed', errorCode: 'RESOURCE_NOT_FOUND' })
        throw new NonRetryableError('RESOURCE_NOT_FOUND')
      }
      const result = await reservation.run(async (signal) => {
        const data = await this.storage.read(payload.receiptKey, signal)
        return this.execution.run(payload.userId, signal, () => this.suggest.execute({ data, mimeType: start.mimeType }, signal))
      })
      await this.work.finish(event, payload, { status: 'succeeded', result })
    } catch (error) {
      if (error instanceof NonRetryableError) throw error
      // Un arrêt du worker compte comme une panne passagère : l'analyse est remise
      // en attente (ou close au dernier essai) plutôt que laissée « running ».
      const code: OcrErrorCode = error instanceof OcrError ? error.code : 'OCR_UNAVAILABLE'
      const retry = TRANSIENT_CODES.has(code)
        && event.attempts < MAX_ANALYSIS_ATTEMPTS
        && Date.now() - event.createdAt.getTime() < ANALYSIS_QUEUE_TIMEOUT_MS
      await this.work.finish(event, payload, retry ? { status: 'queued' } : { status: 'failed', errorCode: code })
      console.error(JSON.stringify({ eventId: event.id, code, attempt: event.attempts, retry }))
      throw retry ? new Error(code) : new NonRetryableError(code)
    } finally {
      reservation?.release()
    }
  }
}
