import path from 'node:path'
import type { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { withUserScope } from '@/lib/db'
import { respondError } from '@/lib/errors'
import { readExpenseInput } from '@/http/readExpenseInput'
import { submitExpenseNote } from '@/composition/submissions'
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

export async function GET(request: NextRequest) {
  try {
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
  } catch (error) {
    return respondError(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    const actor = requireRole(session)
    if (actor instanceof Response) return actor

    const { amount, expenseDate, description, receipt } = await readExpenseInput(request)

    const extension = EXTENSION_BY_MIME[receipt.type] ?? path.extname(receipt.name) ?? ''
    const note = await submitExpenseNote.execute(actor.id, {
      amount,
      expenseDate,
      description,
      receipt: { data: Buffer.from(await receipt.arrayBuffer()), mimeType: receipt.type, extension },
    })

    return Response.json(toExpenseNoteDto(note), { status: 201 })
  } catch (error) {
    return respondError(error)
  }
}
