import { PostgresExpenseNoteListRepository } from '@/modules/expenses/adapters/PostgresExpenseNoteListRepository'
import { ListExpenseNotes } from '@/modules/expenses/application/ListExpenseNotes'

export const listExpenseNotes = new ListExpenseNotes(new PostgresExpenseNoteListRepository())
