import { PostgresExpenseNoteListRepository } from '@/adapters/PostgresExpenseNoteListRepository'
import { ListExpenseNotes } from '@/application/ListExpenseNotes'

export const listExpenseNotes = new ListExpenseNotes(new PostgresExpenseNoteListRepository())
