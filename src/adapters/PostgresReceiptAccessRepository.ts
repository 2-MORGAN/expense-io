import { withUserScope } from '@/lib/db'
import type { UserRole } from '@/domain/User'
import type { ReceiptAccess, ReceiptAccessRepository } from '@/ports/ReceiptAccessRepository'

interface UserRow {
  id: string
  role: UserRole
  manager_id: string | null
  company_id: string
}

interface NoteRow {
  user_id: string
  receipt_key: string
}

// Mêmes lectures que PostgresExpenseNoteDecisionRepository, sans verrou :
// le lecteur, la note, son auteur. La règle d'accès est dans le domaine
// (canViewReceipt) ; la RLS borne en plus chaque lecture à l'entreprise.
export class PostgresReceiptAccessRepository implements ReceiptAccessRepository {
  async findReceipt(noteId: string, viewerId: string): Promise<ReceiptAccess | null> {
    return withUserScope(viewerId, async (client) => {
      const viewerResult = await client.query<UserRow>(
        'SELECT id, role, manager_id, company_id FROM users WHERE id = $1',
        [viewerId]
      )
      const viewer = viewerResult.rows[0]
      if (!viewer) return null

      const noteResult = await client.query<NoteRow>(
        'SELECT user_id, receipt_key FROM expense_notes WHERE id = $1',
        [noteId]
      )
      const note = noteResult.rows[0]
      if (!note) return null

      const submitterResult = await client.query<UserRow>(
        'SELECT id, role, manager_id, company_id FROM users WHERE id = $1',
        [note.user_id]
      )
      const submitter = submitterResult.rows[0]
      if (!submitter) return null

      return {
        receiptKey: note.receipt_key,
        viewer: { id: viewer.id, role: viewer.role, companyId: viewer.company_id },
        submitter: {
          id: submitter.id,
          role: submitter.role,
          managerId: submitter.manager_id,
          companyId: submitter.company_id,
        },
      }
    })
  }
}
