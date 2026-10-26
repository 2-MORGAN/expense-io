import { validateId } from '@/http/validation'
import { auth } from '@/lib/auth'
import { respondError } from '@/lib/errors'
import { decideExpenseNote } from '@/composition/decisions'
import { requireRole } from '@/http/requireRole'
import {
  ExpenseNoteAlreadyDecided,
  ExpenseNoteNotVisible,
} from '@/domain/validation/DecideExpenseNote'

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    const actor = requireRole(session, 'manager')
    if (actor instanceof Response) return actor
    const { id } = await params
    validateId(id)

    try {
      const note = await decideExpenseNote.execute(id, actor.id, 'rejected')
      return Response.json(note)
    } catch (error) {
      if (error instanceof ExpenseNoteNotVisible) {
        return Response.json({ error: 'Not found' }, { status: 404 })
      }
      if (error instanceof ExpenseNoteAlreadyDecided) {
        return Response.json({ error: 'Already decided' }, { status: 409 })
      }
      throw error
    }
  } catch (error) {
    return respondError(error)
  }
}
