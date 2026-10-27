import { validateId } from '@/http/validation'
import { auth } from '@/lib/auth'
import { withApiErrors } from '@/http/withApiErrors'
import { decideExpenseNote } from '@/composition/decisions'
import { requireRole } from '@/http/requireRole'

export const POST = withApiErrors('/api/hr/expense-notes/[id]/reject', async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  const actor = requireRole(session, 'hr_admin')
  if (actor instanceof Response) return actor
  const { id } = await params
  validateId(id)

  const note = await decideExpenseNote.execute(id, actor.id, 'rejected')
  return Response.json(note)
})
