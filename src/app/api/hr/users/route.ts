import { auth } from '@/lib/auth'
import { getPool } from '@/lib/db'
import { respondError } from '@/lib/errors'

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user || session.user.role !== 'hr_admin') {
      return Response.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const result = await getPool().query(
      `SELECT id, name, email, role, manager_id FROM users
       WHERE role IN ('employee', 'manager')
         AND company_id = (SELECT company_id FROM users WHERE id = $1)
       ORDER BY name`,
      [session.user.id]
    )
    return Response.json(
      result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        role: row.role,
        managerId: row.manager_id,
      }))
    )
  } catch (error) {
    return respondError(error)
  }
}
