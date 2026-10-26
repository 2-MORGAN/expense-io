import { PostgresExpenseNoteDecisionRepository } from '@/adapters/PostgresExpenseNoteDecisionRepository'
import { DecideExpenseNote } from '@/application/DecideExpenseNote'

export const expenseNoteDecisionRepository = new PostgresExpenseNoteDecisionRepository()
export const decideExpenseNote = new DecideExpenseNote(expenseNoteDecisionRepository)
