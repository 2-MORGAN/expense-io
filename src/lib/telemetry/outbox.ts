import {
  metrics,
  SpanKind,
  SpanStatusCode,
  trace,
  type Counter,
  type Histogram,
  type Meter,
  type MeterProvider,
} from '@opentelemetry/api'
import type { OutboxTypeBacklog } from '@/lib/outbox'

// Supervision de l'outbox et du worker (ADR-003, T9 ; ADR-007). Seulement
// l'API d'OpenTelemetry : sans SDK démarré (tests, E2E, télémétrie
// désactivée), chaque appel ne fait rien. Aucun attribut ne désigne une
// entreprise ou un utilisateur : les métriques couvrent toute la plateforme.

export type OutboxOutcome = 'sent' | 'retry' | 'dead'

/** État de l'outbox pour les types que traite le worker. */
export interface OutboxBacklog {
  /** Événements `pending`, relances planifiées comprises. */
  pending: number
  /** Événements `pending` dont l'heure est venue : ce que le worker doit traiter maintenant. */
  due: number
  dead: number
  /** Âge du plus ancien événement `pending`, en secondes (0 s'il n'y en a pas). */
  oldestPendingSeconds: number
  /** Retard du plus ancien événement dû sur son heure prévue, en secondes (0 s'il n'y en a pas). */
  dueLagSeconds: number
}

/**
 * Totaux de `outboxStats()` (par type) pour les `types` que ce worker traite :
 * un autre type reste `pending` par construction, pour un worker qui le
 * connaît (`leaseNextDueEvent`), et ne doit pas faire croire à un retard.
 */
export function backlogOf(rows: readonly OutboxTypeBacklog[], types: readonly string[]): OutboxBacklog {
  const handled = rows.filter((row) => types.includes(row.type))
  const sum = (pick: (row: OutboxTypeBacklog) => number) => handled.reduce((total, row) => total + pick(row), 0)
  const max = (pick: (row: OutboxTypeBacklog) => number | null) => Math.max(0, ...handled.map((row) => pick(row) ?? 0))
  return {
    pending: sum((row) => row.pending),
    due: sum((row) => row.due),
    dead: sum((row) => row.dead),
    oldestPendingSeconds: max((row) => row.oldestPendingAgeSeconds),
    dueLagSeconds: max((row) => row.dueLagSeconds),
  }
}

// Seuils de durée d'un traitement, en secondes : d'un email (≈ 0,1 s) à
// l'analyse d'un reçu (jusqu'à 60 s, ADR-003 §1).
const DURATION_BUCKETS = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120]

interface OutboxInstruments {
  processed: Counter
  duration: Histogram
}

function createInstruments(meter: Meter): OutboxInstruments {
  return {
    processed: meter.createCounter('outbox.events.processed', {
      description: 'Événements de l’outbox traités, par type et issue (sent, retry, dead)',
      unit: '{event}',
    }),
    duration: meter.createHistogram('outbox.handler.duration', {
      description: 'Durée du traitement d’un événement de l’outbox par son handler',
      unit: 's',
      advice: { explicitBucketBoundaries: DURATION_BUCKETS },
    }),
  }
}

// L'API ne relie pas après coup un instrument créé avant le démarrage du SDK :
// les instruments suivent le fournisseur global du moment.
let current: { provider: MeterProvider; instruments: OutboxInstruments } | undefined

function instruments(): OutboxInstruments {
  const provider = metrics.getMeterProvider()
  if (current?.provider !== provider) current = { provider, instruments: createInstruments(provider.getMeter('expense-io')) }
  return current.instruments
}

/**
 * Compte l'issue d'un essai et sa durée (`seconds`, celle du handler) ; la
 * reporte aussi sur le span de l'événement (`traceOutboxEvent`), en erreur
 * si l'essai a échoué.
 */
export function recordOutboxOutcome(type: string, outcome: OutboxOutcome, seconds?: number): void {
  const attributes = { 'outbox.event.type': type, 'outbox.outcome': outcome }
  const { processed, duration } = instruments()
  processed.add(1, attributes)
  if (seconds !== undefined) duration.record(seconds, attributes)

  const span = trace.getActiveSpan()
  span?.setAttribute('outbox.outcome', outcome)
  if (outcome !== 'sent') span?.setStatus({ code: SpanStatusCode.ERROR })
}

/**
 * Trace le traitement d'un événement : les requêtes SQL, appels et journaux
 * de `fn` s'y rattachent. Hors d'un tel span, le worker ne trace pas ses
 * interrogations de l'outbox, qui reviennent toutes les deux secondes.
 */
export function traceOutboxEvent<T>(event: { id: string; type: string; attempts: number }, fn: () => Promise<T>): Promise<T> {
  return trace.getTracer('expense-io').startActiveSpan(
    `outbox ${event.type}`,
    {
      kind: SpanKind.CONSUMER,
      attributes: { 'outbox.event.id': event.id, 'outbox.event.type': event.type, 'outbox.event.attempt': event.attempts },
    },
    async (span) => {
      try {
        return await fn()
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR })
        throw error
      } finally {
        span.end()
      }
    }
  )
}

/**
 * État de l'outbox, relu à chaque envoi des métriques : événements en
 * attente, dus, en échec définitif, âge du plus ancien et retard du worker
 * (ADR-003, « Exploitation »). Branché dans le worker, qui le publie lui-même :
 * un worker arrêté ne publie plus rien (alerte « Worker muet »), le retard
 * signale un worker vivant mais bloqué ou débordé.
 */
export function observeOutboxBacklog(meter: Meter, read: () => Promise<OutboxBacklog>): void {
  const pending = meter.createObservableGauge('outbox.events.pending', {
    description: 'Événements de l’outbox en attente, relances planifiées comprises',
    unit: '{event}',
  })
  const due = meter.createObservableGauge('outbox.events.due', {
    description: 'Événements de l’outbox à traiter maintenant',
    unit: '{event}',
  })
  const dead = meter.createObservableGauge('outbox.events.dead', {
    description: 'Événements de l’outbox en échec définitif (dead), à examiner',
    unit: '{event}',
  })
  const oldest = meter.createObservableGauge('outbox.oldest_pending.age', {
    description: 'Âge du plus ancien événement en attente',
    unit: 's',
  })
  const lag = meter.createObservableGauge('outbox.lag', {
    description: 'Retard du plus ancien événement dû : croît si le worker est bloqué ou débordé',
    unit: 's',
  })
  meter.addBatchObservableCallback(async (result) => {
    const backlog = await read()
    result.observe(pending, backlog.pending)
    result.observe(due, backlog.due)
    result.observe(dead, backlog.dead)
    result.observe(oldest, backlog.oldestPendingSeconds)
    result.observe(lag, backlog.dueLagSeconds)
  }, [pending, due, dead, oldest, lag])
}
