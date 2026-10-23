import type { PoolClient } from 'pg'

export type OutboxEvent = {
  id: string
  companyId: string
  type: string
  payload: Record<string, unknown>
  attempts: number
}

export type FailureUpdate = { status: 'pending'; delaySeconds: number } | { status: 'dead' }

/**
 * Réclame l'événement dû le plus ancien parmi `types` (et, si donné, de cette
 * entreprise). `FOR UPDATE SKIP LOCKED` : deux workers ne prennent jamais le
 * même événement ; le verrou dure jusqu'à la fin de la transaction du `client`.
 */
export async function claimNextDueEvent(
  client: PoolClient,
  types: string[],
  companyId?: string
): Promise<OutboxEvent | null> {
  const result = await client.query<{
    id: string
    company_id: string
    type: string
    payload: Record<string, unknown>
    attempts: number
  }>(
    `SELECT id, company_id, type, payload, attempts
     FROM outbox_events
     WHERE status = 'pending'
       AND next_attempt_at <= now()
       AND type = ANY($1::text[])
       AND ($2::uuid IS NULL OR company_id = $2)
     ORDER BY next_attempt_at
     LIMIT 1
     FOR UPDATE SKIP LOCKED`,
    [types, companyId ?? null]
  )
  const row = result.rows[0]
  if (!row) return null
  return {
    id: row.id,
    companyId: row.company_id,
    type: row.type,
    payload: row.payload,
    attempts: row.attempts,
  }
}

/** Pose l'entreprise de l'événement pour la transaction en cours (`app.current_company_id`). */
export async function scopeToCompany(client: PoolClient, companyId: string): Promise<void> {
  await client.query("SELECT set_config('app.current_company_id', $1, true)", [companyId])
}

export async function markSent(client: PoolClient, id: string): Promise<void> {
  await client.query(
    `UPDATE outbox_events
     SET status = 'sent', attempts = attempts + 1, last_error = NULL
     WHERE id = $1`,
    [id]
  )
}

/**
 * Compte l'essai raté, garde la dernière erreur (déjà masquée) et planifie la
 * relance ou clôt l'événement. `clock_timestamp()` et non `now()` : `now()` est
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
     SET attempts = attempts + 1,
         status = $2,
         last_error = $3,
         next_attempt_at = clock_timestamp() + make_interval(secs => $4::double precision)
     WHERE id = $1`,
    [id, update.status, lastError, delaySeconds]
  )
}
