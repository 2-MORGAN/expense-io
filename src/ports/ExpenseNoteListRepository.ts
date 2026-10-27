import type { NoteSort } from '@/domain/expense/NoteSort'

// Une note telle que la base la liste, comme `DecidedExpenseNote` : la mise
// en forme JSON (`toExpenseNoteDto`) reste dans la couche HTTP.
export interface ListedExpenseNote {
  id: string
  user_id: string
  amount: string
  expense_date: string
  description: string
  receipt_key: string
  status: 'pending' | 'approved' | 'rejected'
  created_at: Date
}

// Lectures des listes de notes, une méthode par intention métier. Pour une
// liste, les critères (subordonnés directs, managers racine de l'entreprise)
// sont appliqués par la requête : filtrer en mémoire chargerait toutes les
// notes de l'entreprise.
export interface ExpenseNoteListRepository {
  /** Ses propres notes, tous statuts, dans l'ordre demandé. */
  listOwn(userId: string, sort: NoteSort): Promise<ListedExpenseNote[]>
  /** Notes en attente de ses subordonnés directs, plus anciennes d'abord. */
  listPendingForManager(managerId: string): Promise<ListedExpenseNote[]>
  /** Notes en attente des managers racine de son entreprise, plus anciennes d'abord. */
  listPendingForHr(hrId: string): Promise<ListedExpenseNote[]>
}
