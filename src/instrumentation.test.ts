import { afterEach, expect, it, vi } from 'vitest'
import { onRequestError } from '@/instrumentation'

afterEach(() => vi.restoreAllMocks())

it('journalise une erreur captée par Next.js, sans chaîne de requête ni en-têtes (ADR-005 §5)', async () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  const error = Object.assign(new Error('column "x" does not exist'), { digest: '2948105' })

  await onRequestError(
    error,
    { path: '/api/expense-notes?sort=x', method: 'GET', headers: { cookie: 'authjs.session-token=secret' } },
    { routerKind: 'App Router', routePath: '/api/expense-notes', routeType: 'route', revalidateReason: undefined }
  )

  expect(consoleError).toHaveBeenCalledTimes(1)
  const line = JSON.parse(String(consoleError.mock.calls[0][0]))
  expect(line).toMatchObject({
    level: 'error',
    msg: 'request.error',
    method: 'GET',
    path: '/api/expense-notes',
    route: '/api/expense-notes',
    routeType: 'route',
    digest: '2948105',
    error: 'column "x" does not exist',
  })
  expect(line.stack).toContain('instrumentation.test.ts')
  expect(JSON.stringify(line)).not.toMatch(/secret|sort=/)
})
