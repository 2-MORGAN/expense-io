import { validateId } from '@/http/validation'
import { auth } from '@/lib/auth'
import { withApiErrors } from '@/http/withApiErrors'
import { getReceiptUrl } from '@/composition/receiptUrls'
import { requireRole } from '@/http/requireRole'

export const GET = withApiErrors('/api/expense-notes/[id]/receipt-url', async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  const actor = requireRole(session)
  if (actor instanceof Response) return actor
  const { id } = await params
  validateId(id)

  // Sa propre note seulement ; sinon 404 (ReceiptNotVisible).
  const url = await getReceiptUrl.execute(id, actor.id, 'own')
  return Response.json({ url })
})
