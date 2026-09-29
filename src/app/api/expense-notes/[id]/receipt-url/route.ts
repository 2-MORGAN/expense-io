import { auth } from '@/lib/auth'
import { withUserScope } from '@/lib/db'
import { respondError } from '@/lib/errors'
import { getReceiptUrl } from '@/lib/storage'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { id } = await params

    const note = await withUserScope(session.user.id, async (client) => {
      const result = await client.query(
        'SELECT receipt_key FROM expense_notes WHERE id = $1 AND user_id = $2',
        [id, session.user.id]
      )
      return result.rows[0]
    })
    if (!note) {
      return Response.json({ error: 'Not found' }, { status: 404 })
    }

    const url = await getReceiptUrl(note.receipt_key)
    return Response.json({ url })
  } catch (error) {
    return respondError(error)
  }
}
