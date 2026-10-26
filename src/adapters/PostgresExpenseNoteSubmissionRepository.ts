import { withUserScope } from '@/lib/db'
import type {
  ExpenseNoteSubmissionRepository,
  NewExpenseNote,
  SubmittedExpenseNote,
} from '@/ports/ExpenseNoteSubmissionRepository'

export class PostgresExpenseNoteSubmissionRepository implements ExpenseNoteSubmissionRepository {
  async companyIdOf(userId: string): Promise<string> {
    return withUserScope(userId, async (client) => {
      const result = await client.query<{ company_id: string }>(
        'SELECT company_id FROM users WHERE id = $1',
        [userId]
      )
      if (!result.rows[0]) throw new Error('Unknown user')
      return result.rows[0].company_id
    })
  }

  async create(userId: string, note: NewExpenseNote): Promise<SubmittedExpenseNote> {
    return withUserScope(userId, async (client) => {
      const inserted = await client.query<SubmittedExpenseNote>(
        `INSERT INTO expense_notes (id, user_id, amount, expense_date, description, receipt_key)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [note.id, userId, note.amount, note.expenseDate, note.description, note.receiptKey]
      )
      return inserted.rows[0]
    })
  }

  async find(userId: string, noteId: string): Promise<SubmittedExpenseNote | null> {
    return withUserScope(userId, async (client) => {
      const result = await client.query<SubmittedExpenseNote>(
        'SELECT * FROM expense_notes WHERE id = $1 AND user_id = $2',
        [noteId, userId]
      )
      return result.rows[0] ?? null
    })
  }
}
