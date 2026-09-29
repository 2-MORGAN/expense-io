import { auth } from '@/lib/auth'
import { withUserScope } from '@/lib/db'
import { respondError } from '@/lib/errors'

function toExpenseNote(row: Record<string, unknown>) {
  return {
    id: row.id,
    userId: row.user_id,
    amount: Number.parseFloat(row.amount as string),
    expenseDate: row.expense_date,
    description: row.description,
    receiptKey: row.receipt_key,
    status: row.status,
    createdAt: new Date(row.created_at as string).toISOString(),
  }
}

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user || session.user.role !== 'hr_admin') {
      return Response.json({ error: 'Unauthorized' }, { status: 403 })
    }

    return withUserScope(session.user.id, async (client) => {
      const result = await client.query(
        `SELECT en.* FROM expense_notes en
         JOIN users u ON u.id = en.user_id
         WHERE u.role = 'manager' AND u.manager_id IS NULL AND en.status = 'pending'
           AND u.company_id = (SELECT company_id FROM users WHERE id = $1)
         ORDER BY en.created_at ASC`,
        [session.user.id]
      )
      return Response.json(result.rows.map(toExpenseNote))
    })
  } catch (error) {
    return respondError(error)
  }
}
