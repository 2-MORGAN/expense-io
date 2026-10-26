import type { CompanyUser } from '@/http/dto'
import { validateId, readManagerInput } from '@/http/validation'
import { auth } from '@/lib/auth'
import { getPool } from '@/lib/db'
import { respondError } from '@/lib/errors'
import { requireRole } from '@/http/requireRole'

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
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
      return Response.json({ error: 'Not found' }, { status: 404 })
    }

    const targetResult = await getPool().query(
      `SELECT id FROM users WHERE id = $1 AND company_id = $2 AND role IN ('employee', 'manager')`,
      [id, companyId]
    )
    if (!targetResult.rows[0]) {
      return Response.json({ error: 'Not found' }, { status: 404 })
    }

    if (managerId !== null) {
      if (managerId === id) {
        return Response.json({ error: 'Invalid manager' }, { status: 409 })
      }
      // Le manager choisi doit avoir le rôle manager et appartenir à
      // l'entreprise de la RH (donc de la cible) : un manager d'une autre
      // entreprise est refusé comme un id inconnu.
      const managerResult = await getPool().query(
        `SELECT id FROM users WHERE id = $1 AND role = 'manager' AND company_id = $2`,
        [managerId, companyId]
      )
      if (!managerResult.rows[0]) {
        return Response.json({ error: 'Invalid manager' }, { status: 409 })
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
  } catch (error) {
    return respondError(error)
  }
}
