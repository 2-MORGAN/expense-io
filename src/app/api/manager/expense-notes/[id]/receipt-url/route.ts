import { validateId } from '@/http/validation'
import { auth } from '@/lib/auth'
import { withUserScope } from '@/lib/db'
import { withApiErrors } from '@/http/withApiErrors'
import { problemResponse } from '@/http/problem'
import { requireRole } from '@/http/requireRole'
import { getReceiptUrl } from '@/lib/storage'

export const GET = withApiErrors('/api/manager/expense-notes/[id]/receipt-url', async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  const actor = requireRole(session, 'manager')
  if (actor instanceof Response) return actor
  const { id } = await params
  validateId(id)

  // Seul le manager direct de l'auteur, dans la même entreprise, obtient le
  // reçu : une note hors de son équipe est traitée comme inexistante.
  const note = await withUserScope(actor.id, async (client) => {
    const result = await client.query(
      `SELECT en.receipt_key FROM expense_notes en
       JOIN users u ON u.id = en.user_id
       WHERE en.id = $1 AND u.manager_id = $2
         AND u.company_id = (SELECT company_id FROM users WHERE id = $2)`,
      [id, actor.id]
    )
    return result.rows[0]
  })
  if (!note) {
    return problemResponse('RESOURCE_NOT_FOUND')
  }

  const url = await getReceiptUrl(note.receipt_key)
  return Response.json({ url })
})
