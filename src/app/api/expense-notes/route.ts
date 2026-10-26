import path from 'node:path'
import type { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { getPool, withUserScope } from '@/lib/db'
import { withApiErrors } from '@/http/withApiErrors'
import { receiptKeyFor, uploadReceipt } from '@/lib/storage'
import { toExpenseNoteDto } from '@/http/expenseNote'
import { requireRole } from '@/http/requireRole'
import { readExpenseInput } from '@/http/readExpenseInput'

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
}

// ORDER BY n'accepte pas de paramètre positionnel pour un nom de colonne : le
// tri demandé (`?sort=<colonne> [ASC|DESC]`) est donc lu dans une liste
// blanche, et seules ces expressions fixes atteignent le SQL. Toute autre
// valeur donne le tri par défaut.
const SORTABLE_COLUMNS = ['created_at', 'amount', 'expense_date', 'description', 'status']
const DEFAULT_ORDER_BY = 'created_at DESC'

function orderByFor(sort: string | null): string {
  const match = /^(\w+)(?:\s+(asc|desc))?$/i.exec(sort?.trim() ?? '')
  // Casse ignorée, comme pour un identifiant SQL non cité.
  const column = match?.[1].toLowerCase()
  if (!column || !SORTABLE_COLUMNS.includes(column)) {
    return DEFAULT_ORDER_BY
  }
  const direction = match?.[2]?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC'
  return `${column} ${direction}`
}

export const GET = withApiErrors('/api/expense-notes', async function GET(request: NextRequest) {
  const session = await auth()
  const actor = requireRole(session)
  if (actor instanceof Response) return actor

  const url = new URL(request.url)
  const orderBy = orderByFor(url.searchParams.get('sort'))

  return withUserScope(actor.id, async (client) => {
    const result = await client.query(
      `SELECT * FROM expense_notes WHERE user_id = $1 ORDER BY ${orderBy}`,
      [actor.id]
    )
    return Response.json(result.rows.map(toExpenseNoteDto))
  })
})

export const POST = withApiErrors('/api/expense-notes', async function POST(request: NextRequest) {
  const session = await auth()
  const actor = requireRole(session)
  if (actor instanceof Response) return actor

  const { amount, expenseDate, description, receipt } = await readExpenseInput(request)

  const note = await withUserScope(actor.id, async (client) => {
    const inserted = await client.query(
      `INSERT INTO expense_notes (user_id, amount, expense_date, description, receipt_key)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [actor.id, amount, expenseDate, description, '']
    )
    return inserted.rows[0]
  })

  const extension = EXTENSION_BY_MIME[receipt.type] ?? path.extname(receipt.name) ?? ''
  const receiptKey = receiptKeyFor(note.receipt_seq, extension)
  const buffer = Buffer.from(await receipt.arrayBuffer())
  await uploadReceipt(receiptKey, buffer, receipt.type)

  const updated = await getPool().query(
    `UPDATE expense_notes SET receipt_key = $1 WHERE id = $2 RETURNING *`,
    [receiptKey, note.id]
  )

  return Response.json(toExpenseNoteDto(updated.rows[0]), { status: 201 })
})
