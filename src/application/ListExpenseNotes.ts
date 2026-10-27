import { parseNoteSort } from '@/domain/expense/NoteSort'
import type { ExpenseNoteListRepository, ListedExpenseNote } from '@/ports/ExpenseNoteListRepository'

// Les 3 listes de notes (employé, manager, RH). Les routes gardent
// l'authentification (401/403) et la mise en forme JSON ; le tri demandé
// passe par la règle du domaine avant d'atteindre le repository.
export class ListExpenseNotes {
  constructor(private readonly repository: ExpenseNoteListRepository) {}

  own(userId: string, sort: string | null): Promise<ListedExpenseNote[]> {
    return this.repository.listOwn(userId, parseNoteSort(sort))
  }

  pendingForManager(managerId: string): Promise<ListedExpenseNote[]> {
    return this.repository.listPendingForManager(managerId)
  }

  pendingForHr(hrId: string): Promise<ListedExpenseNote[]> {
    return this.repository.listPendingForHr(hrId)
  }
}
