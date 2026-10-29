import { owner } from './tenant'

// Lecture de l'outbox sous le rôle propriétaire : l'application n'a que
// l'INSERT sur cette table (ADR-001), le test vérifie ce qu'elle y a écrit.

export interface OutboxRow {
  id: string
  companyId: string
  type: string
  payload: Record<string, unknown>
  status: 'pending' | 'sent' | 'dead'
}

interface Row {
  id: string
  company_id: string
  type: string
  payload: Record<string, unknown>
  status: OutboxRow['status']
}

const toRow = (row: Row): OutboxRow => ({
  id: row.id,
  companyId: row.company_id,
  type: row.type,
  payload: row.payload,
  status: row.status,
})

/** Événements d'une entreprise, dans l'ordre d'écriture. */
export async function eventsOfCompany(companyId: string): Promise<OutboxRow[]> {
  const result = await owner().query<Row>(
    'SELECT id, company_id, type, payload, status FROM outbox_events WHERE company_id = $1 ORDER BY created_at, id',
    [companyId]
  )
  return result.rows.map(toRow)
}

/**
 * Événement écrit directement, comme le ferait une transaction de
 * l'application. Pour un test du worker, prendre un type unique
 * (`test.integration.…`) : aucun worker lancé sur la même base ne le réclame.
 */
export async function insertEvent(input: { companyId: string; type: string; payload: Record<string, unknown> }): Promise<string> {
  const result = await owner().query<{ id: string }>(
    'INSERT INTO outbox_events (company_id, type, payload) VALUES ($1, $2, $3) RETURNING id',
    [input.companyId, input.type, JSON.stringify(input.payload)]
  )
  return result.rows[0].id
}

/** État d'un événement : statut, essais, dernière erreur. */
export async function eventState(id: string): Promise<{ status: OutboxRow['status']; attempts: number; lastError: string | null }> {
  const result = await owner().query<{ status: OutboxRow['status']; attempts: number; last_error: string | null }>(
    'SELECT status, attempts, last_error FROM outbox_events WHERE id = $1',
    [id]
  )
  const row = result.rows[0]
  return { status: row.status, attempts: row.attempts, lastError: row.last_error }
}

/** Événements dont le payload désigne cette note. */
export async function eventsOfNote(noteId: string): Promise<OutboxRow[]> {
  const result = await owner().query<Row>(
    "SELECT id, company_id, type, payload, status FROM outbox_events WHERE payload->>'noteId' = $1 ORDER BY created_at, id",
    [noteId]
  )
  return result.rows.map(toRow)
}
