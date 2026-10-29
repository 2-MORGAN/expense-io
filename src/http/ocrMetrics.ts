import { OcrError } from '@/modules/receipt-analysis/domain/OcrError'
import { log } from '@/lib/log'
import { problemCatalogue } from './problem'
import { requestContext } from './requestContext'
import { InputError } from './validation'

/**
 * Métrique `ocr_requests_total{outcome}` (ADR-003 §6, Q5) : une ligne de
 * journal par suggestion OCR terminée, que le collecteur de logs compte par
 * `outcome` (métrique dérivée des logs, ADR-005 §5 amendé). Pas d'exposition
 * HTTP : aucune route n'est ajoutée au contrat.
 */
export const OCR_REQUESTS_METRIC = 'ocr_requests_total'

export type OcrOutcome = 'found' | 'empty' | 'rejected' | 'failed' | 'timeout' | 'overloaded'

export function ocrSuccessOutcome(result: object): OcrOutcome {
  return Object.keys(result).length > 0 ? 'found' : 'empty'
}

export function ocrErrorOutcome(error: unknown): OcrOutcome {
  if (error instanceof InputError) return 'rejected'
  if (!(error instanceof OcrError)) return 'failed'
  if (error.code === 'OCR_TIMEOUT') return 'timeout'
  if (error.code === 'OCR_OVERLOADED') return 'overloaded'
  return problemCatalogue[error.code][0] < 500 ? 'rejected' : 'failed'
}

export function recordOcrRequest(outcome: OcrOutcome, startedAt: number): void {
  const context = requestContext.getStore()
  log('info', 'ocr.request', {
    metric: OCR_REQUESTS_METRIC,
    outcome,
    durationMs: Math.round(performance.now() - startedAt),
    requestId: context?.requestId,
    route: context?.route,
  })
}
