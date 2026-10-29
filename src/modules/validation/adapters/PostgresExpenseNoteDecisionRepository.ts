import { PgEventOutbox } from '@/adapters/PgEventOutbox'
import { withUserScope } from '@/lib/db'
import { ExpenseNote } from '@/modules/expenses/domain/ExpenseNote'
import { expenseNoteDecided } from '@/modules/expenses/domain/Notification'
import {
  ExpenseNoteAlreadyDecided,
  ExpenseNoteNotVisible,
  decideExpenseNote,
  type Decision,
  type DecisionActor,
  type NoteSubmitter,
} from '@/modules/validation/domain/DecideExpenseNote'
import type {
  DecidedExpenseNote,
  ExpenseNoteDecisionRepository,
} from '@/modules/validation/ports/ExpenseNoteDecisionRepository'

interface NoteRow {
  id: string
  user_id: string
  amount: string
  expense_date: string
  description: string
  receipt_key: string
  status: 'pending' | 'approved' | 'rejected'
  created_at: Date
}

interface UserRow {
  id: string
  role: 'employee' | 'manager' | 'hr_admin'
  manager_id: string | null
  company_id: string
}

function toDecided(row: NoteRow, decision: Decision): DecidedExpenseNote {
  return { ...row, status: decision }
}

export class PostgresExpenseNoteDecisionRepository implements ExpenseNoteDecisionRepository {
  async decide(noteId: string, actorId: string, decision: Decision): Promise<DecidedExpenseNote> {
    return withUserScope(actorId, async (client) => {
      const actorResult = await client.query<UserRow>(
        'SELECT id, role, manager_id, company_id FROM users WHERE id = $1',
        [actorId]
      )
      const actorRow = actorResult.rows[0]
      if (!actorRow) throw new ExpenseNoteNotVisible()
      const actor: DecisionActor = {
        id: actorRow.id,
        role: actorRow.role,
        companyId: actorRow.company_id,
      }

      // Verrouille la ligne : deux décisions simultanées sont sérialisées,
      // la seconde voit le statut déjà tranché et reçoit un 409.
      const noteResult = await client.query<NoteRow>('SELECT * FROM expense_notes WHERE id = $1 FOR UPDATE', [
        noteId,
      ])
      const noteRow = noteResult.rows[0]
      if (!noteRow) throw new ExpenseNoteNotVisible()

      const submitterResult = await client.query<UserRow>(
        'SELECT id, role, manager_id, company_id FROM users WHERE id = $1',
        [noteRow.user_id]
      )
      const submitterRow = submitterResult.rows[0]
      if (!submitterRow) throw new ExpenseNoteNotVisible()
      const submitter: NoteSubmitter = {
        id: submitterRow.id,
        role: submitterRow.role,
        managerId: submitterRow.manager_id,
        companyId: submitterRow.company_id,
      }

      const note = new ExpenseNote({
        id: noteRow.id,
        userId: noteRow.user_id,
        amount: Number.parseFloat(noteRow.amount),
        expenseDate: noteRow.expense_date,
        description: noteRow.description,
        receiptKey: noteRow.receipt_key,
        status: noteRow.status,
      })
      const decided = decideExpenseNote(note, submitter, actor, decision)

      // `AND status = 'pending'` en plus du verrou (B8, NOTIF-10) : une
      // décision qui ne touche aucune ligne n'émet aucun événement.
      const updated = await client.query<NoteRow>(
        `UPDATE expense_notes SET status = $1, decided_by = $2, decided_at = now()
         WHERE id = $3 AND status = 'pending' RETURNING *`,
        [decided.status, actor.id, noteId]
      )
      const row = updated.rows[0]
      if (!row) throw new ExpenseNoteAlreadyDecided()
      // « Note tranchée », dans la même transaction que le statut ; une seconde
      // décision (409) ne touche aucune ligne et n'émet rien.
      await new PgEventOutbox(client).enqueue(expenseNoteDecided({ id: row.id, description: row.description, userId: row.user_id }, decision))
      return toDecided(row, decision)
    })
  }
}
