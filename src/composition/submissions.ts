import { PostgresExpenseNoteSubmissionRepository } from '@/modules/expenses/adapters/PostgresExpenseNoteSubmissionRepository'
import { S3ReceiptAdapter } from '@/adapters/S3ReceiptAdapter'
import { SubmitExpenseNote } from '@/modules/expenses/application/SubmitExpenseNote'

export const submitExpenseNote = new SubmitExpenseNote(
  new PostgresExpenseNoteSubmissionRepository(),
  new S3ReceiptAdapter()
)
