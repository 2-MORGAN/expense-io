import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { GET as ownReceipt } from '@/app/api/expense-notes/[id]/receipt-url/route'
import { GET as ownNotes, POST as submit } from '@/app/api/expense-notes/route'
import { GET as hrReceipt } from '@/app/api/hr/expense-notes/[id]/receipt-url/route'
import { GET as managerReceipt } from '@/app/api/manager/expense-notes/[id]/receipt-url/route'
import { EXPENSE_NOTE_SUBMITTED } from '@/domain/Notification'
import type { ExpenseNote } from '@/http/dto'
import { pdfReceipt, pngReceipt, textFile } from '../e2e/support/files'
import { call, noteForm } from './support/api'
import { signInAs } from './support/auth'
import { eventsOfNote } from './support/outbox'
import { storedType } from './support/s3'
import { addMember, createTenant, owner, type Tenant } from './support/tenant'

// Soumission et consultation d'une note par les routes, dans le processus :
// multipart lu et validé, reçu envoyé au S3 de docker-compose.yml, note et
// événement écrits sous la RLS, URL pré-signée qui sert le fichier. Seule la
// session est simulée (support/auth.ts).
vi.mock('@/lib/auth', () => import('./support/auth'))

type Problem = { code: string }

async function submitAs(tenant: Tenant, fields: Parameters<typeof noteForm>[0], headers?: Record<string, string>) {
  signInAs(tenant.employee)
  return call<ExpenseNote & Problem>(submit, 'POST', '/api/expense-notes', { form: noteForm(fields), headers })
}

const valid = (label: string) => ({
  amount: '12.50',
  expenseDate: '2026-10-01',
  description: 'Taxi aéroport',
  receipt: pngReceipt(label),
})

async function notesOf(userId: string): Promise<number> {
  return (await owner().query('SELECT 1 FROM expense_notes WHERE user_id = $1', [userId])).rowCount ?? 0
}

describe('POST /api/expense-notes', () => {
  it('201 : DTO du contrat, reçu stocké sous le préfixe de l’entreprise avec son type, approbateur prévenu', async () => {
    const tenant = await createTenant('api-soumission')
    const reply = await submitAs(tenant, valid('api-soumission'))
    expect(reply.status).toBe(201)
    expect(reply.body).toMatchObject({
      userId: tenant.employee.id,
      amount: 12.5,
      expenseDate: '2026-10-01',
      description: 'Taxi aéroport',
      status: 'pending',
      receiptKey: `receipts/${tenant.company.id}/${reply.body.id}.png`,
    })
    expect(await storedType(reply.body.receiptKey)).toBe('image/png')
    expect((await eventsOfNote(reply.body.id)).map((event) => [event.type, event.payload.recipientIds])).toEqual([
      [EXPENSE_NOTE_SUBMITTED, [tenant.manager.id]],
    ])
  })

  it.each([
    ['montant non numérique', { amount: '12abc' }],
    ['montant au centime près dépassé', { amount: '0.001' }],
    ['date impossible', { expenseDate: '2026-02-30' }],
    ['description vide', { description: '' }],
    ['reçu absent', { receipt: undefined }],
  ])('400 VALIDATION_ERROR (%s) : ni note ni événement', async (_label, override) => {
    const tenant = await createTenant('api-soumission-invalide')
    const reply = await submitAs(tenant, { ...valid('invalide'), ...override })
    expect(reply).toMatchObject({ status: 400, body: { code: 'VALIDATION_ERROR' } })
    expect(await notesOf(tenant.employee.id)).toBe(0)
  })

  it('400 RECEIPT_TYPE_NOT_ALLOWED pour un fichier texte, rien de créé', async () => {
    const tenant = await createTenant('api-soumission-type')
    const reply = await submitAs(tenant, { ...valid('type'), receipt: textFile() })
    expect(reply).toMatchObject({ status: 400, body: { code: 'RECEIPT_TYPE_NOT_ALLOWED' } })
    expect(await notesOf(tenant.employee.id)).toBe(0)
  })

  it('PDF accepté, stocké avec l’extension et le type du PDF', async () => {
    const tenant = await createTenant('api-soumission-pdf')
    const reply = await submitAs(tenant, { ...valid('pdf'), receipt: pdfReceipt('api-pdf') })
    expect(reply.status).toBe(201)
    expect(reply.body.receiptKey).toMatch(/\.pdf$/)
    expect(await storedType(reply.body.receiptKey)).toBe('application/pdf')
  })
})

describe('Idempotency-Key', () => {
  it('même clé, même contenu : 201 rejoué, même note, Idempotent-Replayed', async () => {
    const tenant = await createTenant('api-idempotence')
    const key = randomUUID()
    const fields = valid('api-idempotence')
    const first = await submitAs(tenant, fields, { 'Idempotency-Key': key })
    const again = await submitAs(tenant, fields, { 'Idempotency-Key': key })
    expect(again).toMatchObject({ status: 201, headers: { 'idempotent-replayed': 'true' }, body: { id: first.body.id } })
    expect(await notesOf(tenant.employee.id)).toBe(1)
  })

  it('même clé, autre contenu : 422 IDEMPOTENCY_KEY_REUSED ; clé non UUID : 400 INVALID_IDEMPOTENCY_KEY', async () => {
    const tenant = await createTenant('api-idempotence-refus')
    const key = randomUUID()
    await submitAs(tenant, valid('a'), { 'Idempotency-Key': key })
    expect(await submitAs(tenant, valid('b'), { 'Idempotency-Key': key })).toMatchObject({
      status: 422,
      body: { code: 'IDEMPOTENCY_KEY_REUSED' },
    })
    expect(await submitAs(tenant, valid('c'), { 'Idempotency-Key': 'pas-un-uuid' })).toMatchObject({
      status: 400,
      body: { code: 'INVALID_IDEMPOTENCY_KEY' },
    })
    expect(await notesOf(tenant.employee.id)).toBe(1)
  })

  it('trois envois simultanés de même clé : une seule note, les deux autres rejouées', async () => {
    const tenant = await createTenant('api-idempotence-concurrence')
    const key = randomUUID()
    const fields = valid('concurrence')
    const replies = await Promise.all([1, 2, 3].map(() => submitAs(tenant, fields, { 'Idempotency-Key': key })))
    expect(new Set(replies.map((reply) => reply.body.id)).size).toBe(1)
    expect(replies.filter((reply) => reply.headers['idempotent-replayed'] === 'true')).toHaveLength(2)
    expect(await notesOf(tenant.employee.id)).toBe(1)
  })
})

describe('GET /api/expense-notes', () => {
  let tenant: Tenant
  let ids: string[]

  beforeAll(async () => {
    tenant = await createTenant('api-liste')
    ids = []
    for (const amount of ['30.00', '10.00', '20.00']) ids.push((await submitAs(tenant, { ...valid(amount), amount })).body.id)
  })

  it('ses notes, plus récentes d’abord ; ?sort=amount ASC trie ; un tri hors liste blanche garde le défaut', async () => {
    signInAs(tenant.employee)
    const list = async (query = '') => (await call<ExpenseNote[]>(ownNotes, 'GET', `/api/expense-notes${query}`)).body.map((n) => n.id)
    expect(await list()).toEqual([...ids].reverse())
    expect(await list('?sort=amount%20ASC')).toEqual([ids[1], ids[2], ids[0]])
    expect(await list('?sort=amount%3B%20DROP%20TABLE%20users')).toEqual([...ids].reverse())
  })

  it('un collègue ne voit pas ces notes', async () => {
    const colleague = await addMember(tenant.company, { name: 'Clara Collegue', role: 'employee' })
    signInAs(colleague)
    expect((await call<ExpenseNote[]>(ownNotes, 'GET', '/api/expense-notes')).body).toEqual([])
  })
})

describe('URL de reçu', () => {
  it('l’auteur obtient une URL de 300 s au plus qui sert exactement le fichier envoyé', async () => {
    const tenant = await createTenant('api-recu')
    const receipt = pngReceipt('api-recu-octets')
    const note = (await submitAs(tenant, { ...valid('x'), receipt })).body
    signInAs(tenant.employee)
    const reply = await call<{ url: string }>(ownReceipt, 'GET', `/api/expense-notes/${note.id}/receipt-url`, { params: { id: note.id } })
    expect(Number(new URL(reply.body.url).searchParams.get('X-Amz-Expires'))).toBeLessThanOrEqual(300)
    const file = await fetch(reply.body.url)
    expect(file.headers.get('content-type')).toBe('image/png')
    expect(Buffer.from(await file.arrayBuffer()).equals(receipt.buffer)).toBe(true)
  })

  it('chaque route a son périmètre : collègue 404, manager direct 200, RH 404 pour un employé et 200 pour un manager racine', async () => {
    const tenant = await createTenant('api-recu-perimetre')
    const colleague = await addMember(tenant.company, { name: 'Clara Collegue', role: 'employee', managerId: tenant.manager.id })
    const employeeNote = (await submitAs(tenant, valid('perimetre'))).body.id
    signInAs(tenant.manager)
    const managerNote = (await call<ExpenseNote>(submit, 'POST', '/api/expense-notes', { form: noteForm(valid('racine')) })).body.id

    const fetchUrl = async (handler: unknown, path: string, id: string) => (await call(handler, 'GET', path.replace('{id}', id), { params: { id } })).status
    signInAs(colleague)
    expect(await fetchUrl(ownReceipt, '/api/expense-notes/{id}/receipt-url', employeeNote)).toBe(404)
    signInAs(tenant.manager)
    expect(await fetchUrl(managerReceipt, '/api/manager/expense-notes/{id}/receipt-url', employeeNote)).toBe(200)
    signInAs(tenant.hr)
    expect(await fetchUrl(hrReceipt, '/api/hr/expense-notes/{id}/receipt-url', employeeNote)).toBe(404)
    expect(await fetchUrl(hrReceipt, '/api/hr/expense-notes/{id}/receipt-url', managerNote)).toBe(200)
  })

  it('id de chemin qui n’est pas un UUID : 400 VALIDATION_ERROR avant toute lecture', async () => {
    const tenant = await createTenant('api-recu-uuid')
    signInAs(tenant.employee)
    expect(await call(ownReceipt, 'GET', '/api/expense-notes/pas-un-uuid/receipt-url', { params: { id: 'pas-un-uuid' } })).toMatchObject({
      status: 400,
      body: { code: 'VALIDATION_ERROR' },
    })
  })
})
