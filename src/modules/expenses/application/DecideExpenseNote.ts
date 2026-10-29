import type { Decision } from '@/modules/expenses/domain/DecideExpenseNote'
import type {
  DecidedExpenseNote,
  ExpenseNoteDecisionRepository,
} from '@/modules/expenses/ports/ExpenseNoteDecisionRepository'

// Unique logique de décision utilisée par les 4 routes (manager et RH,
// approve et reject). Les routes gardent l'authentification (401/403) et la
// traduction des erreurs du domaine (404/409) ; tout le reste est ici.
export class DecideExpenseNote {
  constructor(private readonly repository: ExpenseNoteDecisionRepository) {}

  execute(noteId: string, actorId: string, decision: Decision): Promise<DecidedExpenseNote> {
    return this.repository.decide(noteId, actorId, decision)
  }
}
