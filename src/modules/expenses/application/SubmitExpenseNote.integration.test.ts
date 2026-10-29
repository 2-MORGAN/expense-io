import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { IdempotencyKeyReused, SubmitExpenseNote } from './SubmitExpenseNote'
import { PostgresExpenseNoteSubmissionRepository } from '@/modules/expenses/adapters/PostgresExpenseNoteSubmissionRepository'
import { S3ReceiptAdapter } from '@/adapters/S3ReceiptAdapter'
import { storedType } from '../../../../integration/support/s3'
import { createTenant, owner } from '../../../../integration/support/tenant'

// Le cas d'usage avec ses vrais adaptateurs (PostgreSQL sous la RLS, S3) :
// reçu stocké d'abord, puis la note en une transaction (ADR-003 §3), et la
// compensation quand l'écriture échoue — le cas que docs/tests/E2E.md
// déclare « non testable en E2E » (B9), faute de panne injectable par HTTP.

const receipt = (label: string) => ({ data: Buffer.from(`reçu ${label}`), mimeType: 'image/png', extension: '.png' })

function service(noteId = randomUUID()) {
  return { noteId, submit: new SubmitExpenseNote(new PostgresExpenseNoteSubmissionRepository(), new S3ReceiptAdapter(), () => noteId) }
}

describe('SubmitExpenseNote avec PostgreSQL et S3', () => {
  it('stocke le reçu sous une clé opaque préfixée par l’entreprise, puis la note qui la référence', async () => {
    const { employee } = await createTenant('cas-soumission')
    const { noteId, submit } = service()
    const { note, replayed } = await submit.execute(employee.id, { amount: 42.5, expenseDate: '2026-10-01', description: 'Taxi', receipt: receipt('a') })
    expect(replayed).toBe(false)
    expect(note.receipt_key).toBe(`receipts/${employee.companyId}/${noteId}.png`)
    expect(await storedType(note.receipt_key)).toBe('image/png')
  })

  it('l’écriture en base échoue après l’envoi : le reçu est supprimé, aucune note ne reste (compensation, B9)', async () => {
    const { employee } = await createTenant('cas-compensation')
    const { noteId, submit } = service()
    // Montant hors de numeric(10, 2) : le contrôle HTTP l'aurait refusé, la base le refuse ici après l'envoi au S3.
    await expect(
      submit.execute(employee.id, { amount: 1e10, expenseDate: '2026-10-01', description: 'Trop cher', receipt: receipt('b') })
    ).rejects.toMatchObject({ code: '22003' })
    expect(await storedType(`receipts/${employee.companyId}/${noteId}.png`)).toBeNull()
    expect((await owner().query('SELECT 1 FROM expense_notes WHERE id = $1', [noteId])).rowCount).toBe(0)
  })

  it('deux envois concurrents de même clé : une note, et le reçu du perdant supprimé', async () => {
    const { employee } = await createTenant('cas-concurrence')
    const key = randomUUID()
    const input = { amount: 10, expenseDate: '2026-10-01', description: 'Course', receipt: receipt('c'), idempotencyKey: key }
    const first = service()
    const second = service()
    const results = await Promise.all([first.submit.execute(employee.id, input), second.submit.execute(employee.id, input)])
    expect(results[0].note.id).toBe(results[1].note.id)
    const winner = results[0].note.id
    const loser = winner === first.noteId ? second.noteId : first.noteId
    expect(await storedType(`receipts/${employee.companyId}/${winner}.png`)).toBe('image/png')
    expect(await storedType(`receipts/${employee.companyId}/${loser}.png`)).toBeNull()
  })

  it('même clé, autre contenu : IdempotencyKeyReused, rien de stocké en plus', async () => {
    const { employee } = await createTenant('cas-cle-reutilisee')
    const key = randomUUID()
    await service().submit.execute(employee.id, { amount: 10, expenseDate: '2026-10-01', description: 'A', receipt: receipt('d'), idempotencyKey: key })
    const other = service()
    await expect(
      other.submit.execute(employee.id, { amount: 11, expenseDate: '2026-10-01', description: 'B', receipt: receipt('e'), idempotencyKey: key })
    ).rejects.toBeInstanceOf(IdempotencyKeyReused)
    expect(await storedType(`receipts/${employee.companyId}/${other.noteId}.png`)).toBeNull()
  })
})
