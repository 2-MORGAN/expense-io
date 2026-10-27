import type { CompanyUser } from '@/http/dto'
import { validateId, readManagerInput } from '@/http/validation'
import { auth } from '@/lib/auth'
import { getPool } from '@/lib/db'
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

  const hrAdminResult = await getPool().query('SELECT company_id FROM users WHERE id = $1', [
    actor.id,
  ])
  const companyId = hrAdminResult.rows[0]?.company_id
  if (!companyId) {
    return problemResponse('RESOURCE_NOT_FOUND')
  }

  const targetResult = await getPool().query(
    `SELECT id FROM users WHERE id = $1 AND company_id = $2 AND role IN ('employee', 'manager')`,
    [id, companyId]
  )
  if (!targetResult.rows[0]) {
    return problemResponse('RESOURCE_NOT_FOUND')
  }

  if (managerId !== null) {
    if (managerId === id) {
      return problemResponse('INVALID_MANAGER')
    }
    // Le manager choisi doit avoir le rôle manager et appartenir à
    // l'entreprise de la RH (donc de la cible) : un manager d'une autre
    // entreprise est refusé comme un id inconnu.
    const managerResult = await getPool().query(
      `SELECT id FROM users WHERE id = $1 AND role = 'manager' AND company_id = $2`,
      [managerId, companyId]
    )
    if (!managerResult.rows[0]) {
      return problemResponse('INVALID_MANAGER')
    }
  }

  const updated = await getPool().query(
    `UPDATE users SET manager_id = $1 WHERE id = $2
     RETURNING id, name, email, role, manager_id`,
    [managerId, id]
  )
  const user = updated.rows[0]
  return Response.json({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    managerId: user.manager_id,
  } satisfies CompanyUser)
})
