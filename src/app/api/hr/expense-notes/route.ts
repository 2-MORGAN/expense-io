import { auth } from '@/lib/auth'
import { withUserScope } from '@/lib/db'
import { withApiErrors } from '@/http/withApiErrors'
import { toExpenseNoteDto } from '@/http/expenseNote'
import { requireRole } from '@/http/requireRole'

export const GET = withApiErrors('/api/hr/expense-notes', async function GET() {
  const session = await auth()
  const actor = requireRole(session, 'hr_admin')
  if (actor instanceof Response) return actor

  return withUserScope(actor.id, async (client) => {
    const result = await client.query(
      `SELECT en.* FROM expense_notes en
       JOIN users u ON u.id = en.user_id
       WHERE u.role = 'manager' AND u.manager_id IS NULL AND en.status = 'pending'
         AND u.company_id = (SELECT company_id FROM users WHERE id = $1)
       ORDER BY en.created_at ASC`,
      [actor.id]
    )
    return Response.json(result.rows.map(toExpenseNoteDto))
  })
})
