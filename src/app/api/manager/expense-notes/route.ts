import { auth } from '@/lib/auth'
import { listExpenseNotes } from '@/composition/expenseNoteLists'
import { withApiErrors } from '@/http/withApiErrors'
import { toExpenseNoteDto } from '@/http/expenseNote'
import { requireRole } from '@/http/requireRole'

export const GET = withApiErrors('/api/manager/expense-notes', async function GET() {
  const session = await auth()
  const actor = requireRole(session, 'manager')
  if (actor instanceof Response) return actor

  const notes = await listExpenseNotes.pendingForManager(actor.id)
  return Response.json(notes.map(toExpenseNoteDto))
})
