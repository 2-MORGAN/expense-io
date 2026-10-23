import { randomUUID } from 'node:crypto'
import { OcrError, type OcrErrorCode } from '@/domain/receipt/OcrError'

const catalogue: Record<OcrErrorCode, [number, string, string?]> = {
  VALIDATION_ERROR: [400, 'Invalid receipt.', 'Champs invalides'],
  RECEIPT_TOO_LARGE: [400, 'Receipt exceeds the 10 MiB limit.', 'Fichier trop volumineux'],
  RECEIPT_TYPE_NOT_ALLOWED: [400, 'Invalid or unsupported receipt content.'],
  IMAGE_TOO_LARGE: [400, 'Image exceeds the 40 megapixel limit.'],
  OCR_UNAVAILABLE: [503, 'Receipt analysis is temporarily unavailable.'],
  OCR_TIMEOUT: [503, 'Receipt analysis exceeded its time limit.'],
  OCR_OVERLOADED: [503, 'Receipt analysis capacity has been reached.'],
  AUTHENTICATION_REQUIRED: [401, 'Please sign in to continue.', 'Unauthorized'],
  RESOURCE_NOT_FOUND: [404, 'Resource not found.', 'Not found'],
  INVALID_IDEMPOTENCY_KEY: [400, 'Idempotency-Key must be a UUID.'],
  IDEMPOTENCY_KEY_REUSED: [422, 'Idempotency-Key was already used with another receipt.'],
  INTERNAL_ERROR: [500, 'An unexpected error occurred.'],
}

export function ocrProblem(error: unknown) {
  const code = error instanceof OcrError ? error.code : 'INTERNAL_ERROR'
  const [status, detail, legacy] = catalogue[code]
  const requestId = randomUUID()
  if (status >= 500) console.error(JSON.stringify({ requestId, code, outcome: code === 'OCR_TIMEOUT' ? 'timeout' : code === 'OCR_OVERLOADED' ? 'overloaded' : 'failed' }))
  return Response.json({
    type: `/problems/${code.toLowerCase().replaceAll('_', '-')}`,
    title: code.toLowerCase().replaceAll('_', ' '), status, detail, code, requestId,
    error: legacy ?? detail,
  }, { status, headers: {
    'Content-Type': 'application/problem+json', 'X-Request-Id': requestId,
    ...(status === 503 ? { 'Retry-After': '5' } : {}),
  } })
}
