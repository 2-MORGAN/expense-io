import { context, metrics, propagation, trace } from '@opentelemetry/api'
import { logs } from '@opentelemetry/api-logs'
import { afterEach, expect, it, vi } from 'vitest'

// Les contrôles du démarrage (secret, CONF-01 ; rôle de base, 2-481) ont leurs
// propres tests : ici, sans secret ni base.
const checkAuthSecretOrExit = vi.hoisted(() => vi.fn())
const checkDatabaseRoleOrExit = vi.hoisted(() => vi.fn())
vi.mock('@/lib/authSecret', () => ({ checkAuthSecretOrExit }))
vi.mock('@/lib/dbRole', () => ({ checkDatabaseRoleOrExit }))

import { onRequestError, register } from '@/instrumentation'

afterEach(async () => {
  await global.__telemetry?.shutdown()
  global.__telemetry = undefined
  for (const api of [trace, metrics, logs, context, propagation]) api.disable()
  checkAuthSecretOrExit.mockReset()
  checkDatabaseRoleOrExit.mockReset()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

it('sans collecteur configuré, ne démarre pas l’observabilité (ADR-007), et fait ses contrôles', async () => {
  vi.stubEnv('NEXT_RUNTIME', 'nodejs')
  vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', '')
  await register()
  expect(global.__telemetry).toBeUndefined()
  expect(checkAuthSecretOrExit).toHaveBeenCalledTimes(1)
  expect(checkDatabaseRoleOrExit).toHaveBeenCalledWith('web')
})

it('démarre l’observabilité avant les contrôles, dont celui du rôle qui charge pg à instrumenter', { timeout: 20_000 }, async () => {
  vi.stubEnv('NEXT_RUNTIME', 'nodejs')
  // Collecteur injoignable, envois bornés à une seconde.
  vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://127.0.0.1:9')
  vi.stubEnv('OTEL_EXPORTER_OTLP_TIMEOUT', '1000')
  const startedBefore: boolean[] = []
  const record = () => {
    startedBefore.push(global.__telemetry !== undefined)
  }
  checkAuthSecretOrExit.mockImplementation(record)
  checkDatabaseRoleOrExit.mockImplementation(async () => record())

  await register()
  expect(startedBefore).toEqual([true, true])
})

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
