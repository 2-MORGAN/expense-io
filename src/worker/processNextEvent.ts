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
import { describeError, log } from '@/worker/log'
import { nextAttemptAfterFailure } from '@/worker/retry'

export interface OutboxHandler {
  /** Relances après le premier essai (voir `nextAttemptAfterFailure`). */
  maxRetries: number
  /**
   * S'exécute dans la transaction de l'événement, dans un point de sauvegarde :
   * une exception annule les écritures faites avec `client` et déclenche une relance.
   */
  handle(event: OutboxEvent, client: PoolClient): Promise<void>
}

export type OutboxHandlers = Record<string, OutboxHandler>

type HandlerOutcome = { ok: true } | { ok: false; error: unknown }

async function runHandler(handler: OutboxHandler, event: OutboxEvent, client: PoolClient): Promise<HandlerOutcome> {
  try {
    await withSavepoint(client, () => handler.handle(event, client))
    return { ok: true }
  } catch (error) {
    return { ok: false, error }
  }
}

const UNFINISHED_ERROR = 'previous attempt did not finish (worker stopped during handling)'

/**
 * Traite au plus un événement dû, en deux phases. 1) Prise en charge dans une
 * transaction courte : l'essai est compté et un bail de `LEASE_SECONDS` posé
 * (voir `leaseNextDueEvent`). 2) Traitement dans une seconde transaction qui
 * reverrouille la ligne : deux workers ne traitent jamais le même événement.
 * Si l'essai précédent n'a jamais été enregistré (worker tué en plein
 * traitement) et que le budget d'essais est épuisé, l'événement passe `dead`
 * sans rejouer le handler. Ne réclame que les types de `handlers` ; un autre
 * type reste `pending` pour un worker qui le connaît. Rend `false` s'il n'y
 * avait rien à faire, `true` si un événement a été traité (réussi ou non).
 */
export async function processNextEvent(
  handlers: OutboxHandlers,
  filter?: { companyId?: string }
): Promise<boolean> {
  const types = Object.keys(handlers)
  if (types.length === 0) return false

  const leased = await leaseNextDueEvent(types, filter?.companyId)
  if (!leased) return false

  await handleLeasedEvent(handlers, leased)
  return true
}

/**
 * Phase 2 : traite l'événement pris en charge. N'agit que sur sa propre prise
 * en charge (même numéro d'essai) : si le bail a expiré et qu'un autre worker
 * a repris l'événement, ou s'il est déjà terminé, il n'y a rien à faire.
 */
export async function handleLeasedEvent(handlers: OutboxHandlers, leased: OutboxEvent): Promise<void> {
  await withSystemTransaction(async (client) => {
    const event = await lockPendingEvent(client, leased.id, leased.attempts)
    if (!event) return

    await scopeToCompany(client, event.companyId)
    const handler = handlers[event.type]
    const attempts = event.attempts // numéro de l'essai en cours, déjà compté

    if (attempts > handler.maxRetries + 1) {
      await recordFailure(client, event.id, { status: 'dead' }, UNFINISHED_ERROR)
      log('error', 'outbox.dead', { eventId: event.id, type: event.type, attempts, error: UNFINISHED_ERROR })
      return
    }

    const outcome = await runHandler(handler, event, client)

    if (outcome.ok) {
      await markSent(client, event.id)
      log('info', 'outbox.sent', { eventId: event.id, type: event.type, attempts })
      return
    }

    const error = describeError(outcome.error)
    const update = nextAttemptAfterFailure(attempts, handler.maxRetries)
    await recordFailure(client, event.id, update, error)
    if (update.status === 'pending') {
      log('warn', 'outbox.retry', {
        eventId: event.id, type: event.type, attempts, retryInSeconds: update.delaySeconds, error,
      })
    } else {
      log('error', 'outbox.dead', { eventId: event.id, type: event.type, attempts, error })
    }
    return
  })
}
