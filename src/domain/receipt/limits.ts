import policy from '@/generated/receipt-policy.json'

export const MAX_RECEIPT_BYTES = policy.maxBytes
export const MAX_IMAGE_PIXELS = policy.ocrMaxPixels
export const MAX_IMAGE_SIDE = policy.ocrMaxSide
export const OCR_CONCURRENCY = 2
export const OCR_WAITING = 8
export const OCR_TIMEOUT_MS = 15_000
export const ANALYSIS_RETENTION_HOURS = 24
export const ANALYSIS_QUEUE_TIMEOUT_MS = 60_000
