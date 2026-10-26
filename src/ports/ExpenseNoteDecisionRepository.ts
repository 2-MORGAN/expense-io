import type { Decision } from '@/domain/validation/DecideExpenseNote'

export interface DecidedNoteDto {
  id: string
  userId: string
  amount: number
  expenseDate: string
  description: string
  receiptKey: string
  status: 'approved' | 'rejected'
  createdAt: string
}

// Persistance de la décision : charge la note verrouillée (SELECT FOR UPDATE),
// applique la règle du domaine, écrit le statut + l'audit (B16, interne).
export interface ExpenseNoteDecisionRepository {
  decide(noteId: string, actorId: string, decision: Decision): Promise<DecidedNoteDto>
}
