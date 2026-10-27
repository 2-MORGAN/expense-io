import type { CompanyUser } from '@/http/dto'
import { auth } from '@/lib/auth'
import { getPool } from '@/lib/db'
import { withApiErrors } from '@/http/withApiErrors'
import { requireRole } from '@/http/requireRole'

export const GET = withApiErrors('/api/hr/users', async function GET() {
  const session = await auth()
  const actor = requireRole(session, 'hr_admin')
  if (actor instanceof Response) return actor

  const result = await getPool().query(
    `SELECT id, name, email, role, manager_id FROM users
     WHERE role IN ('employee', 'manager')
       AND company_id = (SELECT company_id FROM users WHERE id = $1)
     ORDER BY name`,
    [actor.id]
  )
  return Response.json(
    result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      managerId: row.manager_id,
    } satisfies CompanyUser))
  )
})
