import { context, metrics, propagation, trace } from '@opentelemetry/api'
import { logs } from '@opentelemetry/api-logs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { log } from '@/lib/log'
import { startTelemetry } from '@/lib/telemetry/sdk'

afterEach(async () => {
  await global.__telemetry?.shutdown()
  global.__telemetry = undefined
  trace.disable()
  metrics.disable()
  logs.disable()
  context.disable()
  propagation.disable()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('startTelemetry (ADR-007)', () => {
  it('ne démarre rien sans collecteur configuré', () => {
    expect(startTelemetry('expense-io-test', {})).toBeUndefined()
    expect(global.__telemetry).toBeUndefined()
  })

  it('démarre une seule fois, et un collecteur injoignable ne fait rien échouer', { timeout: 20_000 }, async () => {
    // Port fermé, et envois bornés à une seconde : le collecteur ne répond jamais.
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://127.0.0.1:9')
    vi.stubEnv('OTEL_EXPORTER_OTLP_TIMEOUT', '1000')
    vi.spyOn(console, 'info').mockImplementation(() => {})

    const telemetry = startTelemetry('expense-io-test')
    expect(telemetry).toBeDefined()
    expect(startTelemetry('expense-io-test')).toBe(telemetry)

    trace.getTracer('test').startActiveSpan('requête', (span) => {
      log('info', 'test.event', { id: 'abc' })
      span.end()
    })
    metrics.getMeter('test').createCounter('test.count').add(1)

    await expect(telemetry?.shutdown()).resolves.toBeUndefined()
    // Un second arrêt (fin du worker puis `finally`) ne refait rien.
    await expect(telemetry?.shutdown()).resolves.toBeUndefined()
  })
})
