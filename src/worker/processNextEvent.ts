import type { PoolClient } from 'pg'
import { withSavepoint, withSystemTransaction } from '@/lib/db'
import {
  leaseNextDueEvent,
  lockPendingEvent,
  markSent,
  recordFailure,
  scopeToCompany,
  type OutboxEvent,
} from '@/lib/outbox'
import { recordOutboxOutcome, traceOutboxEvent, type OutboxOutcome } from '@/lib/telemetry/outbox'
import { NonRetryableError } from '@/ports/EventOutbox'
import { describeError, log } from '@/worker/log'
import { nextAttemptAfterFailure } from '@/worker/retry'

interface RetryPolicy {
  /** Relances après le premier essai (voir `nextAttemptAfterFailure`). */
  maxRetries: number
  /** Délais des relances, en secondes ; par défaut ceux de l'ADR-003 §5. */
  backoffSeconds?: readonly number[]
}

/** Traitement court (un email) : il s'exécute dans la transaction de l'événement. */
export interface OutboxHandler extends RetryPolicy {
  /**
   * S'exécute dans la transaction de l'événement, dans un point de sauvegarde :
   * une exception annule les écritures faites avec `client` et déclenche une relance.
   */
  handle(event: OutboxEvent, client: PoolClient): Promise<void>
}

/**
 * Traitement long (OCR, IA) : il s'exécute hors de toute transaction, pour ne
 * pas garder une connexion et un verrou ouverts pendant des dizaines de
 * secondes (ADR-003, amendement du 23/10 §2). Il gère ses propres écritures,
 * dans des transactions courtes, et doit rester idempotent : le bail de
 * `LEASE_SECONDS` borne sa durée, au-delà un autre worker peut reprendre
 * l'événement. Une exception déclenche une relance ; `NonRetryableError`
 * clôt l'événement (`dead`) sans relance.
 */
export interface DetachedOutboxHandler extends RetryPolicy {
  run(event: OutboxEvent, signal: AbortSignal): Promise<void>
}

export type OutboxHandlers = Record<string, OutboxHandler | DetachedOutboxHandler>

/** Issue du handler et sa durée en secondes, pour la supervision (ADR-007). */
type HandlerOutcome = ({ ok: true } | { ok: false; error: unknown }) & { seconds: number }

function isDetached(handler: OutboxHandler | DetachedOutboxHandler): handler is DetachedOutboxHandler {
  return 'run' in handler
}

const secondsSince = (start: number): number => (performance.now() - start) / 1000

async function runHandler(handler: OutboxHandler, event: OutboxEvent, client: PoolClient): Promise<HandlerOutcome> {
  const start = performance.now()
  try {
    await withSavepoint(client, () => handler.handle(event, client))
    return { ok: true, seconds: secondsSince(start) }
  } catch (error) {
    return { ok: false, error, seconds: secondsSince(start) }
  }
}

async function runDetached(handler: DetachedOutboxHandler, event: OutboxEvent, signal: AbortSignal): Promise<HandlerOutcome> {
  const start = performance.now()
  try {
    await handler.run(event, signal)
    return { ok: true, seconds: secondsSince(start) }
  } catch (error) {
    return { ok: false, error, seconds: secondsSince(start) }
  }
}

const UNFINISHED_ERROR = 'previous attempt did not finish (worker stopped during handling)'

const NEVER_ABORTED = new AbortController().signal

/**
 * Traite au plus un événement dû, en deux phases. 1) Prise en charge dans une
 * transaction courte : l'essai est compté et un bail de `LEASE_SECONDS` posé
 * (voir `leaseNextDueEvent`). 2) Traitement dans une seconde transaction qui
 * reverrouille la ligne : deux workers ne traitent jamais le même événement.
 * Un traitement détaché s'exécute entre les deux phases, hors transaction.
 * Si l'essai précédent n'a jamais été enregistré (worker tué en plein
 * traitement) et que le budget d'essais est épuisé, l'événement passe `dead`
 * sans rejouer le handler. Ne réclame que les types de `handlers` ; un autre
 * type reste `pending` pour un worker qui le connaît. Rend `false` s'il n'y
 * avait rien à faire, `true` si un événement a été traité (réussi ou non).
 */
export async function processNextEvent(
  handlers: OutboxHandlers,
  filter?: { companyId?: string; signal?: AbortSignal }
): Promise<boolean> {
  const types = Object.keys(handlers)
  if (types.length === 0) return false

  const leased = await leaseNextDueEvent(types, filter?.companyId)
  if (!leased) return false

  await traceOutboxEvent(leased, () => handleLeasedEvent(handlers, leased, filter?.signal))
  return true
}

/**
 * Phase 2 : traite l'événement pris en charge. N'agit que sur sa propre prise
 * en charge (même numéro d'essai) : si le bail a expiré et qu'un autre worker
 * a repris l'événement, ou s'il est déjà terminé, il n'y a rien à faire.
 */
export async function handleLeasedEvent(
  handlers: OutboxHandlers,
  leased: OutboxEvent,
  signal: AbortSignal = NEVER_ABORTED
): Promise<void> {
  const handler = handlers[leased.type]
  if (isDetached(handler)) {
    await handleDetachedEvent(handler, leased, signal)
    return
  }

  const recorded = await withSystemTransaction(async (client): Promise<RecordedOutcome | undefined> => {
    const event = await lockPendingEvent(client, leased.id, leased.attempts)
    if (!event) return undefined

    await scopeToCompany(client, event.companyId)
    const attempts = event.attempts // numéro de l'essai en cours, déjà compté

    if (attempts > handler.maxRetries + 1) {
      await recordFailure(client, event.id, { status: 'dead' }, UNFINISHED_ERROR)
      log('error', 'outbox.dead', { eventId: event.id, type: event.type, attempts, error: UNFINISHED_ERROR })
      return { outcome: 'dead' }
    }

    return recordOutcome(client, event, handler, await runHandler(handler, event, client))
  })
  if (recorded) recordOutboxOutcome(leased.type, recorded.outcome, recorded.seconds)
}

/**
 * Le traitement s'exécute sans transaction ni verrou, puis son issue est
 * enregistrée dans une transaction courte, seulement si la prise en charge est
 * toujours la sienne. Pas de passage direct à `dead` sur un essai hors
 * budget : c'est le traitement qui clôt ses propres données (par exemple une
 * analyse marquée « failed »), puis l'événement suit la règle des relances.
 */
async function handleDetachedEvent(handler: DetachedOutboxHandler, leased: OutboxEvent, signal: AbortSignal): Promise<void> {
  const outcome = await runDetached(handler, leased, signal)
  const recorded = await withSystemTransaction(async (client): Promise<RecordedOutcome | undefined> => {
    const event = await lockPendingEvent(client, leased.id, leased.attempts)
    if (!event) return undefined
    return recordOutcome(client, event, handler, outcome)
  })
  if (recorded) recordOutboxOutcome(leased.type, recorded.outcome, recorded.seconds)
}

/**
 * Issue enregistrée en base, mesurée par l'appelant une fois la transaction
 * validée (ADR-007) : un COMMIT en échec ne compte pas un essai qui sera rejoué.
 */
type RecordedOutcome = { outcome: OutboxOutcome; seconds?: number }

async function recordOutcome(
  client: PoolClient,
  event: OutboxEvent,
  handler: OutboxHandler | DetachedOutboxHandler,
  outcome: HandlerOutcome
): Promise<RecordedOutcome> {
  const attempts = event.attempts
  if (outcome.ok) {
    await markSent(client, event.id)
    log('info', 'outbox.sent', { eventId: event.id, type: event.type, attempts })
    return { outcome: 'sent', seconds: outcome.seconds }
  }

  const error = describeError(outcome.error)
  const update = outcome.error instanceof NonRetryableError
    ? { status: 'dead' as const }
    : nextAttemptAfterFailure(attempts, handler.maxRetries, handler.backoffSeconds)
  await recordFailure(client, event.id, update, error)
  if (update.status === 'pending') {
    log('warn', 'outbox.retry', {
      eventId: event.id, type: event.type, attempts, retryInSeconds: update.delaySeconds, error,
    })
    return { outcome: 'retry', seconds: outcome.seconds }
  }
  log('error', 'outbox.dead', { eventId: event.id, type: event.type, attempts, error })
  return { outcome: 'dead', seconds: outcome.seconds }
}
