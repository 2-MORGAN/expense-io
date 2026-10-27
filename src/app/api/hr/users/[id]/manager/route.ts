import type { CompanyUser } from '@/http/dto'
import { validateId, readManagerInput } from '@/http/validation'
import { auth } from '@/lib/auth'
import { companyDirectory } from '@/composition/companyDirectory'
import { withApiErrors } from '@/http/withApiErrors'
import { problemResponse } from '@/http/problem'
import { requireRole } from '@/http/requireRole'

export const PUT = withApiErrors('/api/hr/users/[id]/manager', async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  const actor = requireRole(session, 'hr_admin')
  if (actor instanceof Response) return actor
  const { id } = await params
  validateId(id)
  const { managerId } = await readManagerInput(request)

  const result = await companyDirectory.assignManager(actor.id, id, managerId)
  if (result.kind === 'not_found') return problemResponse('RESOURCE_NOT_FOUND')
  if (result.kind === 'invalid_manager') return problemResponse('INVALID_MANAGER')
  return Response.json(result.user satisfies CompanyUser)
})
