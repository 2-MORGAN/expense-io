import { describe, expect, it } from 'vitest'
import { OcrError } from '@/domain/receipt/OcrError'
import { ocrErrorOutcome, ocrSuccessOutcome } from './ocrMetrics'
import { InputError } from './validation'

describe('outcome de la métrique ocr_requests_total (ADR-003 §6)', () => {
  it('succès : found si un champ est suggéré, empty sinon', () => {
    expect(ocrSuccessOutcome({ amount: 12 })).toBe('found')
    expect(ocrSuccessOutcome({})).toBe('empty')
  })

  it('échecs : timeout, overloaded, failed pour une panne, rejected pour une entrée refusée', () => {
    expect(ocrErrorOutcome(new OcrError('OCR_TIMEOUT'))).toBe('timeout')
    expect(ocrErrorOutcome(new OcrError('OCR_OVERLOADED'))).toBe('overloaded')
    expect(ocrErrorOutcome(new OcrError('OCR_UNAVAILABLE'))).toBe('failed')
    expect(ocrErrorOutcome(new OcrError('RECEIPT_TOO_LARGE'))).toBe('rejected')
    expect(ocrErrorOutcome(new InputError())).toBe('rejected')
    expect(ocrErrorOutcome(new Error('boom'))).toBe('failed')
  })
})
