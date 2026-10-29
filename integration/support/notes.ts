import { randomUUID } from 'node:crypto'
import { PostgresExpenseNoteDecisionRepository } from '@/modules/validation/adapters/PostgresExpenseNoteDecisionRepository'
import { PostgresExpenseNoteSubmissionRepository } from '@/modules/expenses/adapters/PostgresExpenseNoteSubmissionRepository'
import type { Decision } from '@/modules/validation/domain/DecideExpenseNote'
import type { DecidedExpenseNote } from '@/modules/validation/ports/ExpenseNoteDecisionRepository'
import type { SubmittedExpenseNote } from '@/modules/expenses/ports/ExpenseNoteSubmissionRepository'
import type { Member } from './tenant'

// Notes créées et tranchées par les vrais adaptateurs, sous `expense_app` :
// les policies d'insertion et de mise à jour s'appliquent, comme en
// production. Le reçu n'est pas envoyé à S3 : seule sa clé compte ici.

let counter = 0

export interface NoteInput {
  amount?: number
  expenseDate?: string
  description?: string
}

export async function submitNote(author: Member, input: NoteInput = {}): Promise<SubmittedExpenseNote> {
  counter += 1
  const id = randomUUID()
  return new PostgresExpenseNoteSubmissionRepository().create(author.id, {
    id,
    amount: input.amount ?? 42.5,
    expenseDate: input.expenseDate ?? '2026-10-01',
    description: input.description ?? `Note ${counter} de ${author.name}`,
    receiptKey: `receipts/${author.companyId}/${id}.png`,
  })
}

export function decide(noteId: string, actor: Member, decision: Decision): Promise<DecidedExpenseNote> {
  return new PostgresExpenseNoteDecisionRepository().decide(noteId, actor.id, decision)
}
