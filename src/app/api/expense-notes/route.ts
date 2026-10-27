import path from 'node:path'
import type { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { withUserScope } from '@/lib/db'
import { withApiErrors } from '@/http/withApiErrors'
import { readExpenseInput } from '@/http/readExpenseInput'
import { submitExpenseNote } from '@/composition/submissions'
import { IdempotencyKeyReused, InvalidIdempotencyKey } from '@/application/SubmitExpenseNote'
import { problemResponse } from '@/http/problem'
import { toExpenseNoteDto } from '@/http/expenseNote'
import { requireRole } from '@/http/requireRole'

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

  const extension = EXTENSION_BY_MIME[receipt.type] ?? path.extname(receipt.name) ?? ''
  let result
  try {
    result = await submitExpenseNote.execute(actor.id, {
      amount,
      expenseDate,
      description,
      receipt: { data: Buffer.from(await receipt.arrayBuffer()), mimeType: receipt.type, extension },
      idempotencyKey: request.headers.get('idempotency-key'),
    })
  } catch (error) {
    // Problèmes communs (RFC 9457, 2-485) : 400 et 422 du contrat.
    if (error instanceof InvalidIdempotencyKey) return problemResponse('INVALID_IDEMPOTENCY_KEY')
    if (error instanceof IdempotencyKeyReused) return problemResponse('IDEMPOTENCY_KEY_REUSED')
    throw error
  }

  return Response.json(toExpenseNoteDto(result.note), {
    status: 201,
    headers: result.replayed ? { 'Idempotent-Replayed': 'true' } : undefined,
  })
})
