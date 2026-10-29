import { PostgresExpenseNoteDecisionRepository } from '@/adapters/PostgresExpenseNoteDecisionRepository'
import { DecideExpenseNote } from '@/modules/expenses/application/DecideExpenseNote'

export const expenseNoteDecisionRepository = new PostgresExpenseNoteDecisionRepository()
export const decideExpenseNote = new DecideExpenseNote(expenseNoteDecisionRepository)
