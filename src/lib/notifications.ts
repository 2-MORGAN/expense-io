import type { PoolClient } from 'pg'
import { PgEventOutbox } from '@/adapters/PgEventOutbox'
import {
  approverIds,
  expenseNoteDecided,
  expenseNoteSubmitted,
  type NoteDecision,
} from '@/domain/Notification'
import type { UserRole } from '@/domain/User'

type NoteRef = { id: string; description: string; userId: string }

/**
 * Publie « note soumise » dans la transaction du `client` (celle de
 * `withUserScope`). Le soumetteur sans approbateur (employé sans manager, RH)
 * n'a personne à prévenir : la note existe, aucun événement n'est écrit.
 */
export async function enqueueSubmitted(client: PoolClient, note: NoteRef): Promise<void> {
  const submitter = await client.query<{
    name: string
    role: UserRole
    manager_id: string | null
    company_id: string
  }>('SELECT name, role, manager_id, company_id FROM users WHERE id = $1', [note.userId])
  const row = submitter.rows[0]
  if (!row) throw new Error('Submitter not found')

  // Seul un manager racine passe par les RH de son entreprise.
  const isRootManager = row.role === 'manager' && row.manager_id === null
  const hrAdminIds = isRootManager
    ? (
        await client.query<{ id: string }>(
          `SELECT id FROM users WHERE company_id = $1 AND role = 'hr_admin' ORDER BY created_at`,
          [row.company_id]
        )
      ).rows.map((hr) => hr.id)
    : []

  const recipientIds = approverIds({ role: row.role, managerId: row.manager_id }, hrAdminIds)
  if (recipientIds.length === 0) return

  await new PgEventOutbox(client).enqueue(expenseNoteSubmitted(note, row.name, recipientIds))
}

/**
 * Publie « note tranchée » dans la transaction du `client`. À n'appeler que
 * si l'`UPDATE ... AND status = 'pending'` a modifié une ligne : une seconde
 * décision (409) n'émet rien.
 */
export async function enqueueDecided(
  client: PoolClient,
  note: NoteRef,
  decision: NoteDecision
): Promise<void> {
  await new PgEventOutbox(client).enqueue(expenseNoteDecided(note, decision))
}
