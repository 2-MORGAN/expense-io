import { validateId } from '@/http/validation'
import { auth } from '@/lib/auth'
import { withApiErrors } from '@/http/withApiErrors'
import { getReceiptUrl } from '@/composition/receiptUrls'
import { requireRole } from '@/http/requireRole'

export const GET = withApiErrors('/api/manager/expense-notes/[id]/receipt-url', async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  const actor = requireRole(session, 'manager')
  if (actor instanceof Response) return actor
  const { id } = await params
  validateId(id)

  // Seul le manager direct de l'auteur, dans la même entreprise, obtient le
  // reçu : une note hors de son équipe est traitée comme inexistante (404).
  const url = await getReceiptUrl.execute(id, actor.id, 'team')
  return Response.json({ url })
})
