import { expect, it } from 'vitest'
import { OcrError } from '@/domain/receipt/OcrError'
import { ocrProblem } from './ocrProblem'

it.each(['OCR_UNAVAILABLE', 'OCR_TIMEOUT', 'OCR_OVERLOADED'] as const)('returns a safe 503 for %s', async (code) => {
  const response = ocrProblem(new OcrError(code))
  expect(response.status).toBe(503)
  expect(response.headers.get('Retry-After')).toBe('5')
  expect(response.headers.get('Content-Type')).toContain('application/problem+json')
  expect(await response.json()).toMatchObject({ code, status: 503 })
})

it('does not expose unexpected errors or their stacks', async () => {
  const response = ocrProblem(new Error('password=private'))
  expect(response.status).toBe(500)
  expect(await response.text()).not.toContain('private')
})
