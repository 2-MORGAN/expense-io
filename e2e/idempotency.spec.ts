import { randomUUID } from 'node:crypto'
import { db } from './support/db'
import { expectApiError } from './support/api'
import { expect, test } from './support/fixtures'
import { pngReceipt, type UploadFile } from './support/files'

// 2-476 étape 2 (ADR-003 §4) : renvoyer le formulaire avec la même
// `Idempotency-Key` ne crée pas de doublon. Sans l'en-tête, rien ne change.
const fields = (description: string, receipt: UploadFile) => ({
  amount: '42.50', expenseDate: '2026-10-01', description, receipt,
})

test.describe('Soumission de note : renvoi sans doublon', () => {
  test('[IDEM-01] même clé, même contenu : 201 avec la même note, Idempotent-Replayed, une seule ligne', async ({
    org,
    apiAs,
  }) => {
    const api = await apiAs(org.employee)
    const key = randomUUID()
    const receipt = pngReceipt('idem-01')
    const headers = { 'Idempotency-Key': key }

    const first = await api.request.post('/api/expense-notes', { multipart: fields('Hôtel', receipt), headers })
    expect(first.status()).toBe(201)
    expect(first.headers()['idempotent-replayed']).toBeUndefined()
    const created = await first.json()

    const second = await api.request.post('/api/expense-notes', { multipart: fields('Hôtel', receipt), headers })
    expect(second.status()).toBe(201)
    expect(second.headers()['idempotent-replayed']).toBe('true')
    expect(await second.json()).toEqual(created)

    expect(await api.notes()).toHaveLength(1)
    const { rows } = await db().query('SELECT count(*)::int AS n FROM expense_notes WHERE user_id = $1', [org.employee.id])
    expect(rows[0].n).toBe(1)
  })

  test('[IDEM-02] deux requêtes simultanées de même clé : une seule note', async ({ org, apiAs }) => {
    const api = await apiAs(org.employee)
    const headers = { 'Idempotency-Key': randomUUID() }
    const receipt = pngReceipt('idem-02')

    const responses = await Promise.all(
      [1, 2, 3].map(() => api.request.post('/api/expense-notes', { multipart: fields('Train', receipt), headers }))
    )
    expect(responses.map((r) => r.status())).toEqual([201, 201, 201])
    const ids = new Set((await Promise.all(responses.map((r) => r.json()))).map((n) => n.id))
    expect(ids.size).toBe(1)
    expect(await api.notes()).toHaveLength(1)
  })

  test('[IDEM-03] même clé, contenu différent : 422, rien de créé en plus', async ({ org, apiAs }) => {
    const api = await apiAs(org.employee)
    const headers = { 'Idempotency-Key': randomUUID() }
    const receipt = pngReceipt('idem-03')
    expect((await api.request.post('/api/expense-notes', { multipart: fields('Taxi', receipt), headers })).status()).toBe(201)

    const other = await api.request.post('/api/expense-notes', { multipart: fields('Autre dépense', receipt), headers })
    expect(other.status()).toBe(422)
    expect(await other.json()).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' })
    expect(await api.notes()).toHaveLength(1)
  })

  test('[IDEM-04] clé mal formée : 400', async ({ org, apiAs }) => {
    const api = await apiAs(org.employee)
    const response = await api.request.post('/api/expense-notes', {
      multipart: fields('Taxi', pngReceipt('idem-04')),
      headers: { 'Idempotency-Key': 'pas-un-uuid' },
    })
    await expectApiError(response, 400, 'Invalid idempotency key')
    expect(await api.notes()).toHaveLength(0)
  })

  test('[IDEM-05] la clé est propre à l’utilisateur : un collègue avec la même clé crée sa propre note', async ({
    org,
    apiAs,
  }) => {
    const key = randomUUID()
    const receipt = pngReceipt('idem-05')
    const employee = await apiAs(org.employee)
    const manager = await apiAs(org.manager)
    const a = await employee.request.post('/api/expense-notes', { multipart: fields('Repas', receipt), headers: { 'Idempotency-Key': key } })
    const b = await manager.request.post('/api/expense-notes', { multipart: fields('Repas', receipt), headers: { 'Idempotency-Key': key } })
    expect(a.status()).toBe(201)
    expect(b.status()).toBe(201)
    expect(b.headers()['idempotent-replayed']).toBeUndefined()
    expect((await a.json()).id).not.toBe((await b.json()).id)
  })

  test('[IDEM-06] sans en-tête : deux envois identiques créent deux notes (comportement inchangé)', async ({
    org,
    apiAs,
  }) => {
    const api = await apiAs(org.employee)
    const receipt = pngReceipt('idem-06')
    await api.request.post('/api/expense-notes', { multipart: fields('Café', receipt) })
    await api.request.post('/api/expense-notes', { multipart: fields('Café', receipt) })
    expect(await api.notes()).toHaveLength(2)
  })
})
