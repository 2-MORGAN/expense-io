import type { CompanyUser } from '@/http/dto'
import { auth } from '@/lib/auth'
import { companyDirectory } from '@/composition/companyDirectory'
import { withApiErrors } from '@/http/withApiErrors'
import { requireRole } from '@/http/requireRole'

export const GET = withApiErrors('/api/hr/users', async function GET() {
  const session = await auth()
  const actor = requireRole(session, 'hr_admin')
  if (actor instanceof Response) return actor

  const members = await companyDirectory.listMembers(actor.id)
  return Response.json(members satisfies CompanyUser[])
})
