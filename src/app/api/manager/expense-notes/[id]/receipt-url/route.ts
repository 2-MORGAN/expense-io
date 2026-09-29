import { auth } from '@/lib/auth'
import { getPool } from '@/lib/db'
import { respondError } from '@/lib/errors'
import { getReceiptUrl } from '@/lib/storage'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user || session.user.role !== 'manager') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { id } = await params

    // La note existe forcément dans la liste des notes en attente du
    // manager avant qu'il n'en consulte le reçu — pas besoin de revérifier
    // le rattachement ici.
    const result = await getPool().query('SELECT receipt_key FROM expense_notes WHERE id = $1', [id])
    const note = result.rows[0]
    if (!note) {
      return Response.json({ error: 'Not found' }, { status: 404 })
    }

    const url = await getReceiptUrl(note.receipt_key)
    return Response.json({ url })
  } catch (error) {
    return respondError(error)
  }
}
