export type OcrErrorCode =
  | 'VALIDATION_ERROR' | 'RECEIPT_TOO_LARGE' | 'RECEIPT_TYPE_NOT_ALLOWED'
  | 'IMAGE_TOO_LARGE' | 'OCR_UNAVAILABLE' | 'OCR_TIMEOUT' | 'OCR_OVERLOADED'
  | 'AUTHENTICATION_REQUIRED' | 'RESOURCE_NOT_FOUND' | 'INVALID_IDEMPOTENCY_KEY'
  | 'IDEMPOTENCY_KEY_REUSED' | 'INTERNAL_ERROR'

export class OcrError extends Error {
  constructor(readonly code: OcrErrorCode) {
    super(code)
    this.name = 'OcrError'
  }
}
