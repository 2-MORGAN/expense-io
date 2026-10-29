import { OcrError } from '@/modules/receipt-analysis/domain/OcrError'
import { ReceiptNotVisible } from '@/modules/expenses/domain/ReceiptAccess'
import { ExpenseNoteAlreadyDecided, ExpenseNoteNotVisible } from '@/modules/expenses/domain/DecideExpenseNote'
import { log, logError } from '@/lib/log'
import { InputError } from './validation'
import { problemCatalogue, problemResponse, type ProblemCode } from './problem'
import { requestContext } from './requestContext'

export function respondError(error: unknown): Response {
  if (error instanceof InputError) return problemResponse(error.code, { errors: error.errors, legacy: error.legacy })
  const code: ProblemCode = error instanceof ExpenseNoteNotVisible || error instanceof ReceiptNotVisible ? 'RESOURCE_NOT_FOUND'
    : error instanceof ExpenseNoteAlreadyDecided ? 'ALREADY_DECIDED'
      : error instanceof OcrError ? error.code : 'INTERNAL_ERROR'
  // These two OCR refusals historically used their English public detail in error.
  const legacy = error instanceof OcrError && (code === 'RECEIPT_TYPE_NOT_ALLOWED' || code === 'INVALID_IDEMPOTENCY_KEY')
    ? problemCatalogue[code][2] : undefined
  const response = problemResponse(code, { legacy })
  const status = problemCatalogue[code][0]
  if (status >= 500) {
    const fields = {
      ...requestContext.getStore(), requestId: response.headers.get('X-Request-Id'), status, code,
      outcome: code === 'OCR_TIMEOUT' ? 'timeout' : code === 'OCR_OVERLOADED' ? 'overloaded' : 'failed',
    }
    if (error instanceof OcrError && code !== 'INTERNAL_ERROR') log('error', 'http.error', fields)
    else logError('http.error', error, fields)
  }
  return response
}
