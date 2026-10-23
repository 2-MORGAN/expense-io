import { db } from './db'

// Lecture et préparation de la table `outbox_events` pour les tests du
// worker. Connexion d'administration (`db()`) : l'application, elle, n'a que
// l'INSERT (ADR-001).

export type OutboxStatus = 'pending' | 'sent' | 'dead'

export interface OutboxRow {
  id: string
  companyId: string
  type: string
  payload: Record<string, unknown>
  status: OutboxStatus
  attempts: number
  nextAttemptAt: Date
  lastError: string | null
}

/** Insère un événement tel quel (statut `pending`), avec des valeurs de test éventuelles. */
export async function insertOutboxEvent(input: {
  companyId: string
  type: string
  payload?: Record<string, unknown>
  attempts?: number
  nextAttemptAt?: Date
}): Promise<string> {
  const result = await db().query<{ id: string }>(
    `INSERT INTO outbox_events (company_id, type, payload, attempts, next_attempt_at)
     VALUES ($1, $2, $3, $4, COALESCE($5, now()))
     RETURNING id`,
    [
      input.companyId,
      input.type,
      JSON.stringify(input.payload ?? {}),
      input.attempts ?? 0,
      input.nextAttemptAt ?? null,
    ]
  )
  return result.rows[0].id
}

export async function outboxEvent(id: string): Promise<OutboxRow> {
  const result = await db().query<OutboxRow>(
    `SELECT id, company_id AS "companyId", type, payload, status, attempts,
            next_attempt_at AS "nextAttemptAt", last_error AS "lastError"
     FROM outbox_events
     WHERE id = $1`,
    [id]
  )
  if (!result.rows[0]) throw new Error(`Événement d'outbox introuvable : ${id}`)
  return result.rows[0]
}

/** Événements dont le payload référence la note, du plus ancien au plus récent. */
export async function outboxEventsForNote(noteId: string): Promise<OutboxRow[]> {
  const result = await db().query<OutboxRow>(
    `SELECT id, company_id AS "companyId", type, payload, status, attempts,
            next_attempt_at AS "nextAttemptAt", last_error AS "lastError"
     FROM outbox_events
     WHERE payload->>'noteId' = $1
     ORDER BY created_at`,
    [noteId]
  )
  return result.rows
}
