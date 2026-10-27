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

// Métrique ocr_requests_total{outcome} (ADR-003 §6) : une ligne de journal par appel.
function metricLines(spy: { mock: { calls: unknown[][] } }) {
  return spy.mock.calls.map((call) => JSON.parse(String(call[0])) as Record<string, unknown>)
    .filter((line) => line.metric === 'ocr_requests_total')
}

function receiptForm(label: string) {
  const form = new FormData()
  form.set('receipt', new File([new Uint8Array(pngReceipt(label).buffer)], 'receipt.png', { type: 'image/png' }))
  return form
}

it('counts a suggestion with fields as outcome "found", correlated with the request', async () => {
  const info = vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.mocked(ocrRequests.suggest).mockResolvedValue({ amount: 12.5 })
  await suggest(new Request('http://localhost', { method: 'POST', body: receiptForm('found') }))
  const [line] = metricLines(info)
  expect(line).toMatchObject({ msg: 'ocr.request', outcome: 'found', route: '/api/expense-notes/receipt-suggestion' })
  expect(line.requestId).toEqual(expect.any(String))
  info.mockRestore()
})

it('counts an empty suggestion as "empty" and an engine failure as "failed"', async () => {
  const info = vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.mocked(ocrRequests.suggest).mockResolvedValueOnce({}).mockRejectedValueOnce(new OcrError('OCR_UNAVAILABLE'))
  await suggest(new Request('http://localhost', { method: 'POST', body: receiptForm('empty') }))
  await suggest(new Request('http://localhost', { method: 'POST', body: receiptForm('failed') }))
  expect(metricLines(info).map((line) => line.outcome)).toEqual(['empty', 'failed'])
  vi.restoreAllMocks()
})
