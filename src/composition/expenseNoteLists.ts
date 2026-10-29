import { PostgresExpenseNoteListRepository } from '@/adapters/PostgresExpenseNoteListRepository'
import { ListExpenseNotes } from '@/modules/expenses/application/ListExpenseNotes'

export const listExpenseNotes = new ListExpenseNotes(new PostgresExpenseNoteListRepository())
