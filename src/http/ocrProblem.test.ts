import { expect, it, vi } from 'vitest'
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

it('logs the cause of an unexpected error under the requestId returned to the client (ADR-005 §5)', async () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  const response = ocrProblem(new Error('Connection terminated unexpectedly'))
  const { requestId } = await response.json()

  const line = JSON.parse(String(consoleError.mock.calls[0][0]))
  consoleError.mockRestore()
  expect(line).toMatchObject({
    level: 'error',
    msg: 'http.error',
    requestId,
    status: 500,
    code: 'INTERNAL_ERROR',
    error: 'Connection terminated unexpectedly',
  })
  expect(line.stack).toContain('ocrProblem.test.ts')
})

it('logs an identified 503 without its stack', () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  ocrProblem(new OcrError('OCR_OVERLOADED'))

  const line = JSON.parse(String(consoleError.mock.calls[0][0]))
  consoleError.mockRestore()
  expect(line).toMatchObject({ level: 'error', msg: 'http.error', status: 503, code: 'OCR_OVERLOADED', outcome: 'overloaded' })
  expect(line).not.toHaveProperty('stack')
})
