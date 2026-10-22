import { beforeEach, expect, it, vi } from 'vitest'
import { OcrError } from '@/domain/receipt/OcrError'
import { pngReceipt } from '../../e2e/support/files'

vi.mock('@/lib/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'test-user' } })) }))
vi.mock('@/composition/ocr', async () => {
  const { OcrCapacity } = await import('@/application/OcrCapacity')
  return { ocrCapacity: new OcrCapacity(), ocrRequests: { suggest: vi.fn() } }
})
import { ocrRequests } from '@/composition/ocr'
import { suggest } from './ocrHandlers'

beforeEach(() => { vi.mocked(ocrRequests.suggest).mockReset() })

it('returns 503 instead of an empty success when the OCR engine fails', async () => {
  vi.mocked(ocrRequests.suggest).mockRejectedValue(new OcrError('OCR_UNAVAILABLE'))
  const form = new FormData()
  form.set('receipt', new File([new Uint8Array(pngReceipt('failure').buffer)], 'receipt.png', { type: 'image/png' }))
  const response = await suggest(new Request('http://localhost', { method: 'POST', body: form }))
  expect(response.status).toBe(503)
  expect(response.headers.get('Retry-After')).toBe('5')
  expect(await response.json()).toMatchObject({ code: 'OCR_UNAVAILABLE' })
})
