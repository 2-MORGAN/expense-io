import { describe, expect, it, vi } from 'vitest'
import { SuggestReceiptFields } from './SuggestReceiptFields'
import { pdfReceipt, pngReceipt } from '../../e2e/support/files'

describe('receipt suggestion use case', () => {
  const signal = new AbortController().signal
  it('extracts fields through the OCR port', async () => {
    const recognize = vi.fn(async () => 'TOTAL TTC : 42,50 EUR\nDate : 11/10/2026')
    const file = pngReceipt('test')
    expect(await new SuggestReceiptFields({ recognize, inspect: vi.fn() }).execute({ data: file.buffer, mimeType: file.mimeType }, signal))
      .toEqual({ amount: 42.5, expenseDate: '2026-10-11' })
  })
  it('preserves empty success for PDF and never invokes the engine', async () => {
    const recognize = vi.fn()
    const file = pdfReceipt('test')
    expect(await new SuggestReceiptFields({ recognize, inspect: vi.fn() }).execute({ data: file.buffer, mimeType: file.mimeType }, signal)).toEqual({})
    expect(recognize).not.toHaveBeenCalled()
  })
  it('propagates an engine failure instead of returning an empty success', async () => {
    const file = pngReceipt('failure')
    const recognize = vi.fn().mockRejectedValue(new Error('engine offline'))
    await expect(new SuggestReceiptFields({ recognize, inspect: vi.fn() }).execute({ data: file.buffer, mimeType: file.mimeType }, signal)).rejects.toThrow('engine offline')
  })
})
