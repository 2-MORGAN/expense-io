import path from 'node:path'
import type { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { getPool, withUserScope } from '@/lib/db'
import { respondError } from '@/lib/errors'
import { receiptKeyFor, uploadReceipt } from '@/lib/storage'

const ALLOWED_RECEIPT_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf']
const MAX_RECEIPT_BYTES = 10 * 1024 * 1024

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
}

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

export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(request.url)
    // Le tri est construit dynamiquement plutôt que via une valeur liée :
    // ORDER BY n'accepte pas de paramètre positionnel pour un nom de colonne
    // en SQL standard, donc ce fragment est concaténé directement.
    const sort = url.searchParams.get('sort') || 'created_at DESC'

    return withUserScope(session.user.id, async (client) => {
      const result = await client.query(
        `SELECT * FROM expense_notes WHERE user_id = $1 ORDER BY ${sort}`,
        [session.user.id]
      )
      return Response.json(result.rows.map(toExpenseNote))
    })
  } catch (error) {
    return respondError(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const formData = await request.formData()
    const amountRaw = formData.get('amount')
    const expenseDate = formData.get('expenseDate')
    const description = formData.get('description')
    const receipt = formData.get('receipt')

    const amount = typeof amountRaw === 'string' ? Number.parseFloat(amountRaw) : NaN

    if (
      !Number.isFinite(amount) ||
      amount <= 0 ||
      typeof expenseDate !== 'string' ||
      typeof description !== 'string' ||
      description.trim().length === 0 ||
      !(receipt instanceof File)
    ) {
      return Response.json({ error: 'Champs invalides' }, { status: 400 })
    }
    if (!ALLOWED_RECEIPT_TYPES.includes(receipt.type)) {
      return Response.json({ error: 'Type de fichier non autorisé pour le reçu' }, { status: 400 })
    }
    if (receipt.size > MAX_RECEIPT_BYTES) {
      return Response.json({ error: 'Fichier trop volumineux' }, { status: 400 })
    }

    const note = await withUserScope(session.user.id, async (client) => {
      const inserted = await client.query(
        `INSERT INTO expense_notes (user_id, amount, expense_date, description, receipt_key)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [session.user.id, amount, expenseDate, description, '']
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

    return Response.json(toExpenseNote(updated.rows[0]), { status: 201 })
  } catch (error) {
    return respondError(error)
  }
}
