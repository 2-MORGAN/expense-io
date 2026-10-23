import type { PoolClient } from 'pg'
import { withSystemTransaction } from '@/lib/db'
import type { OutboxEventRecord } from '@/ports/EventOutbox'

export type OutboxEvent = OutboxEventRecord

export type FailureUpdate = { status: 'pending'; delaySeconds: number } | { status: 'dead' }

/** Durée du bail : un événement pris en charge n'est pas repris avant ce délai. */
export const LEASE_SECONDS = 300

type OutboxRow = {
  id: string
  company_id: string
  type: string
  payload: Record<string, unknown>
  attempts: number
  created_at: Date
}

function toEvent(row: OutboxRow): OutboxEvent {
  return {
    id: row.id,
    companyId: row.company_id,
    type: row.type,
    payload: row.payload,
    attempts: row.attempts,
    createdAt: row.created_at,
  }
}

/**
 * Phase 1 : prend en charge l'événement dû le plus ancien parmi `types` (et,
 * si donné, de cette entreprise), dans sa propre transaction courte. L'essai
 * est compté tout de suite (`attempts + 1`) et `next_attempt_at` recule de
 * `LEASE_SECONDS` : si le worker s'arrête pendant le traitement, l'essai reste
 * compté et l'événement redevient dû à l'expiration du bail, au lieu d'être
 * rejoué sans fin sans jamais atteindre `dead`. `FOR UPDATE SKIP LOCKED` : deux
 * workers ne prennent jamais le même événement. `attempts` rendu est le numéro
 * de l'essai qui commence.
 */
export async function leaseNextDueEvent(
  types: string[],
  companyId?: string
): Promise<OutboxEvent | null> {
  return withSystemTransaction(async (client) => {
    const result = await client.query<OutboxRow>(
      `UPDATE outbox_events
       SET attempts = attempts + 1,
           next_attempt_at = clock_timestamp() + make_interval(secs => $3::double precision)
       WHERE id = (
         SELECT id
         FROM outbox_events
         WHERE status = 'pending'
           AND next_attempt_at <= now()
           AND type = ANY($1::text[])
           AND ($2::uuid IS NULL OR company_id = $2)
         ORDER BY next_attempt_at
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING id, company_id, type, payload, attempts, created_at`,
      [types, companyId ?? null, LEASE_SECONDS]
    )
    const row = result.rows[0]
    return row ? toEvent(row) : null
  })
}

/**
 * Phase 2 : reverrouille l'événement pris en charge pour la durée de la
 * transaction du `client`. Un worker encore en train de traiter garde ce
 * verrou, donc un autre ne le reprend pas même si le bail a expiré. Rend
 * `null` si l'événement n'est plus `pending` (terminé entre-temps) ou si
 * `attempts` a changé : le bail a expiré et un autre worker a repris
 * l'événement, la phase 2 ne doit agir que sur sa propre prise en charge.
 */
export async function lockPendingEvent(
  client: PoolClient,
  id: string,
  attempts: number
): Promise<OutboxEvent | null> {
  const result = await client.query<OutboxRow>(
    `SELECT id, company_id, type, payload, attempts, created_at
     FROM outbox_events
     WHERE id = $1 AND status = 'pending' AND attempts = $2
     FOR UPDATE`,
    [id, attempts]
  )
  const row = result.rows[0]
  return row ? toEvent(row) : null
}

/** Pose l'entreprise de l'événement pour la transaction en cours (`app.current_company_id`). */
export async function scopeToCompany(client: PoolClient, companyId: string): Promise<void> {
  await client.query("SELECT set_config('app.current_company_id', $1, true)", [companyId])
}

export async function markSent(client: PoolClient, id: string): Promise<void> {
  await client.query(
    `UPDATE outbox_events
     SET status = 'sent', last_error = NULL
     WHERE id = $1`,
    [id]
  )
}

/**
 * Garde la dernière erreur (déjà masquée) et planifie la relance ou clôt
 * l'événement ; l'essai a déjà été compté à la prise en charge. `clock_timestamp()` et non `now()` : `now()` est
 * l'heure du `BEGIN`, le délai serait compté depuis la réclamation et un
 * handler lent le raccourcirait.
 */
export async function recordFailure(
  client: PoolClient,
  id: string,
  update: FailureUpdate,
  lastError: string
): Promise<void> {
  const delaySeconds = update.status === 'pending' ? update.delaySeconds : 0
  await client.query(
    `UPDATE outbox_events
     SET status = $2,
         last_error = $3,
         next_attempt_at = clock_timestamp() + make_interval(secs => $4::double precision)
     WHERE id = $1`,
    [id, update.status, lastError, delaySeconds]
  )
}
