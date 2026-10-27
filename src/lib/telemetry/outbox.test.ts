import { context, metrics, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import { MeterProvider, MetricReader, type MetricData } from '@opentelemetry/sdk-metrics'
import { InMemorySpanExporter, SimpleSpanProcessor, TracerProvider } from '@opentelemetry/sdk-trace'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { backlogOf, observeOutboxBacklog, recordOutboxOutcome, traceOutboxEvent } from '@/lib/telemetry/outbox'

describe('backlogOf', () => {
  it('totalise les types que traite le worker, avec l’âge et le retard les plus grands', () => {
    const rows = [
      { type: 'invitation.requested', pending: 2, due: 1, dead: 0, oldestPendingAgeSeconds: 30, dueLagSeconds: 12 },
      { type: 'receipt.analysis.requested', pending: 1, due: 0, dead: 3, oldestPendingAgeSeconds: 600, dueLagSeconds: null },
      // Aucun handler de ce worker : laissé pending par construction, il ne fait pas croire à un retard.
      { type: 'test.unhandled', pending: 5, due: 5, dead: 0, oldestPendingAgeSeconds: 10_800, dueLagSeconds: 10_800 },
    ]
    expect(backlogOf(rows, ['invitation.requested', 'receipt.analysis.requested'])).toEqual({
      pending: 3, due: 1, dead: 3, oldestPendingSeconds: 600, dueLagSeconds: 12,
    })
  })

  it('outbox vide : zéros', () => {
    expect(backlogOf([], ['invitation.requested'])).toEqual({
      pending: 0, due: 0, dead: 0, oldestPendingSeconds: 0, dueLagSeconds: 0,
    })
  })
})

/** Lecteur de métriques à la demande. */
class TestReader extends MetricReader {
  protected onForceFlush(): Promise<void> {
    return Promise.resolve()
  }

  protected onShutdown(): Promise<void> {
    return Promise.resolve()
  }
}

let reader: TestReader
let spans: InMemorySpanExporter

// Un SDK minimal enregistré comme fournisseur global, comme dans le worker.
beforeEach(() => {
  reader = new TestReader()
  metrics.setGlobalMeterProvider(new MeterProvider({ readers: [reader] }))
  spans = new InMemorySpanExporter()
  trace.setGlobalTracerProvider(new TracerProvider({ spanProcessors: [new SimpleSpanProcessor({ exporter: spans })] }))
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable())
})

afterEach(() => {
  metrics.disable()
  trace.disable()
  context.disable()
})

async function collected(): Promise<Record<string, MetricData>> {
  const { resourceMetrics } = await reader.collect()
  return Object.fromEntries(resourceMetrics.scopeMetrics.flatMap((scope) => scope.metrics).map((m) => [m.descriptor.name, m]))
}

describe('recordOutboxOutcome', () => {
  it('compte chaque issue par type d’événement et mesure la durée du handler', async () => {
    recordOutboxOutcome('invitation.requested', 'sent', 0.2)
    recordOutboxOutcome('invitation.requested', 'retry', 1.5)
    recordOutboxOutcome('receipt.analysis.requested', 'dead')

    const metric = await collected()
    expect(metric['outbox.events.processed'].dataPoints.map((p) => [p.attributes, p.value])).toEqual([
      [{ 'outbox.event.type': 'invitation.requested', 'outbox.outcome': 'sent' }, 1],
      [{ 'outbox.event.type': 'invitation.requested', 'outbox.outcome': 'retry' }, 1],
      [{ 'outbox.event.type': 'receipt.analysis.requested', 'outbox.outcome': 'dead' }, 1],
    ])
    // Un essai jamais terminé (worker arrêté) passe dead sans durée.
    expect(metric['outbox.handler.duration'].dataPoints).toHaveLength(2)
    expect(metric['outbox.handler.duration'].descriptor.unit).toBe('s')
  })

  it('sans SDK démarré (tests, E2E, télémétrie désactivée), ne fait rien', () => {
    metrics.disable()
    trace.disable()
    expect(() => recordOutboxOutcome('invitation.requested', 'sent', 0.1)).not.toThrow()
  })
})

describe('traceOutboxEvent', () => {
  it('trace le traitement, avec l’issue de l’essai et une erreur s’il a échoué', async () => {
    const result = await traceOutboxEvent({ id: 'evt-1', type: 'invitation.requested', attempts: 2 }, async () => {
      recordOutboxOutcome('invitation.requested', 'retry', 0.1)
      return 'traité'
    })

    expect(result).toBe('traité')
    const [span] = spans.getFinishedSpans()
    expect(span.name).toBe('outbox invitation.requested')
    expect(span.kind).toBe(SpanKind.CONSUMER)
    expect(span.attributes).toEqual({
      'outbox.event.id': 'evt-1', 'outbox.event.type': 'invitation.requested', 'outbox.event.attempt': 2, 'outbox.outcome': 'retry',
    })
    expect(span.status.code).toBe(SpanStatusCode.ERROR)
  })

  it('relance l’exception du traitement, après avoir fermé le span', async () => {
    const failure = traceOutboxEvent({ id: 'evt-2', type: 'invitation.requested', attempts: 1 }, () =>
      Promise.reject(new Error('base indisponible'))
    )
    await expect(failure).rejects.toThrow('base indisponible')
    expect(spans.getFinishedSpans()[0].status.code).toBe(SpanStatusCode.ERROR)
  })
})

describe('observeOutboxBacklog', () => {
  it('relit l’état de l’outbox à chaque collecte des métriques', async () => {
    let reads = 0
    observeOutboxBacklog(metrics.getMeter('test'), async () => {
      reads += 1
      return { pending: 4, due: 1, dead: 2, oldestPendingSeconds: 90, dueLagSeconds: 12 }
    })

    const metric = await collected()
    const values = Object.fromEntries(Object.entries(metric).map(([name, m]) => [name, m.dataPoints[0].value]))
    expect(values).toEqual({
      'outbox.events.pending': 4,
      'outbox.events.due': 1,
      'outbox.events.dead': 2,
      'outbox.oldest_pending.age': 90,
      'outbox.lag': 12,
    })
    expect(reads).toBe(1)
  })
})
