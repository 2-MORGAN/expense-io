import type { Decision } from '@/modules/expenses/domain/DecideExpenseNote'

// La note tranchée telle que la base la connaît, comme `SubmittedExpenseNote` :
// la mise en forme JSON de l'API (`toExpenseNoteDto`) reste dans la couche
// HTTP. Un adaptateur sortant ne dépend pas de la couche d'entrée (ADR-002 §3.3).
export interface DecidedExpenseNote {
  id: string
  user_id: string
  amount: string
  expense_date: string
  description: string
  receipt_key: string
  status: Decision
  created_at: Date
}

// Persistance de la décision : charge la note verrouillée (SELECT FOR UPDATE),
// applique la règle du domaine, écrit le statut + l'audit (B16, interne).
export interface ExpenseNoteDecisionRepository {
  decide(noteId: string, actorId: string, decision: Decision): Promise<DecidedExpenseNote>
}
