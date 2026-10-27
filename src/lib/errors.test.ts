import { afterEach, expect, it, vi } from 'vitest'
import { respondError } from '@/lib/errors'

afterEach(() => vi.restoreAllMocks())

// Le journal conserve le diagnostic serveur sans exposer ces détails au client (S6).
it('journalise l’erreur en une ligne JSON, avec sa pile et sans email (ADR-005 §5)', () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  respondError(new Error('duplicate key for jane.doe@acme.test'))

  expect(consoleError).toHaveBeenCalledTimes(1)
  const line = JSON.parse(String(consoleError.mock.calls[0][0]))
  expect(line).toMatchObject({
    level: 'error',
    msg: 'http.error',
    status: 500,
    error: 'duplicate key for [email]',
  })
  expect(line.stack).toContain('errors.test.ts')
})
