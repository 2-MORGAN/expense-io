import { withUserScope } from '@/lib/db'
import type { NoteSort } from '@/modules/expenses/domain/NoteSort'
import type { ExpenseNoteListRepository, ListedExpenseNote } from '@/ports/ExpenseNoteListRepository'

// ORDER BY n'accepte pas de paramètre positionnel pour un nom de colonne :
// une requête complète et fixe par tri autorisé (liste blanche explicite,
// CLAUDE.md règle 3), choisie par la clé fermée de `parseNoteSort`. Aucune
// valeur venue du client n'atteint le SQL. Chaque tri se termine par `id`,
// dans le même sens, pour un ordre stable entre deux lectures (ADR-004 §7.2).
const OWN_NOTES: Record<NoteSort, string> = {
  'created_at ASC': 'SELECT * FROM expense_notes WHERE user_id = $1 ORDER BY created_at ASC, id ASC',
  'created_at DESC': 'SELECT * FROM expense_notes WHERE user_id = $1 ORDER BY created_at DESC, id DESC',
  'amount ASC': 'SELECT * FROM expense_notes WHERE user_id = $1 ORDER BY amount ASC, id ASC',
  'amount DESC': 'SELECT * FROM expense_notes WHERE user_id = $1 ORDER BY amount DESC, id DESC',
  'expense_date ASC': 'SELECT * FROM expense_notes WHERE user_id = $1 ORDER BY expense_date ASC, id ASC',
  'expense_date DESC': 'SELECT * FROM expense_notes WHERE user_id = $1 ORDER BY expense_date DESC, id DESC',
  'description ASC': 'SELECT * FROM expense_notes WHERE user_id = $1 ORDER BY description ASC, id ASC',
  'description DESC': 'SELECT * FROM expense_notes WHERE user_id = $1 ORDER BY description DESC, id DESC',
  'status ASC': 'SELECT * FROM expense_notes WHERE user_id = $1 ORDER BY status ASC, id ASC',
  'status DESC': 'SELECT * FROM expense_notes WHERE user_id = $1 ORDER BY status DESC, id DESC',
}

// Mêmes critères que les règles du domaine pour une seule note :
// subordonné direct (DecideExpenseNote, canViewReceipt 'team') et manager
// racine de l'entreprise (canViewReceipt 'company'). La RLS borne en plus
// chaque lecture à l'entreprise du lecteur.
const PENDING_FOR_MANAGER = `SELECT en.* FROM expense_notes en
  JOIN users u ON u.id = en.user_id
  WHERE u.manager_id = $1 AND en.status = 'pending'
  ORDER BY en.created_at ASC, en.id ASC`

const PENDING_FOR_HR = `SELECT en.* FROM expense_notes en
  JOIN users u ON u.id = en.user_id
  WHERE u.role = 'manager' AND u.manager_id IS NULL AND en.status = 'pending'
    AND u.company_id = (SELECT company_id FROM users WHERE id = $1)
  ORDER BY en.created_at ASC, en.id ASC`

export class PostgresExpenseNoteListRepository implements ExpenseNoteListRepository {
  listOwn(userId: string, sort: NoteSort): Promise<ListedExpenseNote[]> {
    return this.list(userId, OWN_NOTES[sort])
  }

  listPendingForManager(managerId: string): Promise<ListedExpenseNote[]> {
    return this.list(managerId, PENDING_FOR_MANAGER)
  }

  listPendingForHr(hrId: string): Promise<ListedExpenseNote[]> {
    return this.list(hrId, PENDING_FOR_HR)
  }

  private list(viewerId: string, query: string): Promise<ListedExpenseNote[]> {
    return withUserScope(viewerId, async (client) => {
      const result = await client.query<ListedExpenseNote>(query, [viewerId])
      return result.rows
    })
  }
}
