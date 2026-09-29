import { auth } from '@/lib/auth'
import { withUserScope } from '@/lib/db'
import { respondError } from '@/lib/errors'

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user || session.user.role !== 'manager') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { id } = await params

    return withUserScope(session.user.id, async (client) => {
      const existing = await client.query(
        `SELECT en.* FROM expense_notes en
         JOIN users u ON u.id = en.user_id
         WHERE en.id = $1 AND u.manager_id = $2`,
        [id, session.user.id]
      )
      const row = existing.rows[0]
      if (!row) {
        return Response.json({ error: 'Not found' }, { status: 404 })
      }
      if (row.status !== 'pending') {
        return Response.json({ error: 'Already decided' }, { status: 409 })
      }

      const updated = await client.query(
        `UPDATE expense_notes SET status = 'rejected' WHERE id = $1 RETURNING *`,
        [id]
      )
      const note = updated.rows[0]
      return Response.json({
        id: note.id,
        userId: note.user_id,
        amount: Number.parseFloat(note.amount),
        expenseDate: note.expense_date,
        description: note.description,
        receiptKey: note.receipt_key,
        status: note.status,
        createdAt: new Date(note.created_at).toISOString(),
      })
    })
  } catch (error) {
    return respondError(error)
  }
}
