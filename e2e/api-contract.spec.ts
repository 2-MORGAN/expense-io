import { expect, test } from './support/fixtures'
import { pngReceipt, receiptForType, type UploadFile } from './support/files'
import { db } from './support/db'

// ADR-004 §6 : les rejets structurels précèdent toute mutation.
test('[API-01] montants et dates stricts, aucune note créée sur rejet', async ({ org, apiAs }) => {
  const api = await apiAs(org.employee)
  for (const input of [
    { amount: '12abc' }, { amount: '0.001' }, { amount: '1e2' }, { amount: '100000000' },
    { expenseDate: '0000-01-01' }, { expenseDate: '2023-02-29' }, { expenseDate: '2024-04-31' },
  ]) {
    const response = await api.createNote({ amount: '12.50', expenseDate: '2024-02-29', description: 'Contrat', receipt: pngReceipt('api-01'), ...input })
    expect(response.status()).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'VALIDATION_ERROR' })
  }
  expect(await api.notes()).toEqual([])
  const valid = await api.submitNote({ amount: '99999999.99', expenseDate: '2024-02-29' })
  expect(valid.amount).toBe(99999999.99)
})

test('[API-02] absence et JSON invalide ne détachent pas le manager, null le détache', async ({ org, apiAs }) => {
  const api = await apiAs(org.hr)
  const url = `/api/hr/users/${org.employee.id}/manager`
  for (const body of ['{}', 'null', '[]', '{bad', '{"managerId":"bad"}', '{"managerId":42}']) {
    const response = await api.request.put(url, { data: body, headers: { 'Content-Type': 'application/json' } })
    expect(response.status()).toBe(400)
    expect((await db().query('SELECT manager_id FROM users WHERE id = $1', [org.employee.id])).rows[0].manager_id).toBe(org.manager.id)
  }
  expect((await api.setManager(org.employee.id, null)).status()).toBe(200)
  expect((await api.hrUsers()).find(user => user.id === org.employee.id)?.managerId).toBeNull()
})

test('[API-03] UUID invalides → 400, gardes session et rôle prioritaires', async ({ org, apiAs, request }) => {
  const employee = await apiAs(org.employee)
  const manager = await apiAs(org.manager)
  const hr = await apiAs(org.hr)
  for (const [api, method, url] of [
    [employee, 'GET', '/api/expense-notes/bad/receipt-url'],
    [employee, 'GET', '/api/receipt-analyses/bad'],
    [manager, 'GET', '/api/manager/expense-notes/bad/receipt-url'],
    [manager, 'POST', '/api/manager/expense-notes/bad/approve'],
    [manager, 'POST', '/api/manager/expense-notes/bad/reject'],
    [hr, 'GET', '/api/hr/expense-notes/bad/receipt-url'],
    [hr, 'POST', '/api/hr/expense-notes/bad/approve'],
    [hr, 'POST', '/api/hr/expense-notes/bad/reject'],
    [hr, 'PUT', '/api/hr/users/bad/manager'],
  ] as const) {
    const response = await api.request.fetch(url, { method, ...(method === 'PUT' ? { data: { managerId: null } } : {}) })
    expect(response.status()).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'VALIDATION_ERROR', errors: [{ field: 'id', code: 'INVALID_UUID' }] })
  }
  expect((await request.get('/api/expense-notes/bad/receipt-url')).status()).toBe(401)
  expect((await employee.request.post('/api/manager/expense-notes/bad/approve')).status()).toBe(403)
})

test('[API-04] reçus vides, falsifiés et PDF corrompus sont refusés sans création', async ({ org, apiAs }) => {
  const api = await apiAs(org.employee)
  const png = pngReceipt('api-04')
  const files: UploadFile[] = [
    { ...png, buffer: Buffer.alloc(0) },
    { ...png, mimeType: 'image/jpeg', name: 'faux.jpg' },
    { ...png, buffer: png.buffer.subarray(0, 30) },
    { name: 'faux.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nnot a document\n%%EOF\n') },
  ]
  for (const receipt of files) {
    expect((await api.createNote({ amount: '12', expenseDate: '2024-02-29', description: 'Refus', receipt })).status()).toBe(400)
  }
  expect(await api.notes()).toEqual([])
  const pdf = receiptForType('pdf-valide', 'application/pdf')
  const suggestion = await api.suggest(pdf)
  expect(suggestion.status()).toBe(200)
  expect(await suggestion.json()).toEqual({})
  expect((await api.suggest(files.at(-1))).status()).toBe(400)
})
