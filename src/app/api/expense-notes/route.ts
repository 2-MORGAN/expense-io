import path from 'node:path'
import type { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { withApiErrors } from '@/http/withApiErrors'
import { readExpenseInput } from '@/http/readExpenseInput'
import { submitExpenseNote } from '@/composition/submissions'
import { listExpenseNotes } from '@/composition/expenseNoteLists'
import { IdempotencyKeyReused, InvalidIdempotencyKey } from '@/modules/expenses/application/SubmitExpenseNote'
import { problemResponse } from '@/http/problem'
import { toExpenseNoteDto } from '@/http/expenseNote'
import { requireRole } from '@/http/requireRole'

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
}

export const GET = withApiErrors('/api/expense-notes', async function GET(request: NextRequest) {
  const session = await auth()
  const actor = requireRole(session)
  if (actor instanceof Response) return actor

  // Tri `?sort=` par liste blanche, analysé par le domaine (NoteSort).
  const sort = new URL(request.url).searchParams.get('sort')
  const notes = await listExpenseNotes.own(actor.id, sort)
  return Response.json(notes.map(toExpenseNoteDto))
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
