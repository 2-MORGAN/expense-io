import { validateId } from '@/http/validation'
import { auth } from '@/lib/auth'
import { withApiErrors } from '@/http/withApiErrors'
import { getReceiptUrl } from '@/composition/receiptUrls'
import { requireRole } from '@/http/requireRole'

export const GET = withApiErrors('/api/hr/expense-notes/[id]/receipt-url', async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  const actor = requireRole(session, 'hr_admin')
  if (actor instanceof Response) return actor
  const { id } = await params
  validateId(id)

  // Notes des managers racine de l'entreprise seulement ; sinon 404.
  const url = await getReceiptUrl.execute(id, actor.id, 'company')
  return Response.json({ url })
})
