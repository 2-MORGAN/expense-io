import { randomUUID } from 'node:crypto'
import { test, expect } from './support/fixtures'
import { db } from './support/db'
import { PostgresOutboxAdapter } from '../src/adapters/PostgresOutboxAdapter'
import { PostgresReceiptAnalysisWork } from '../src/adapters/PostgresReceiptAnalysisWork'
import { closeWorkerDb } from '../src/lib/workerDb'
import { withOcrExecution } from '../src/adapters/PostgresOcrExecution'

test.afterAll(async () => { await closeWorkerDb() })

test('[OCR-17] expired outbox lease is reclaimable and stale completion is ignored', async ({ org }) => {
  // Type propre au test : le worker de l'application ne le consomme pas.
  const type = `test.receipt.${randomUUID()}`
  const id = randomUUID()
  await db().query('INSERT INTO outbox_events (id, company_id, type, payload) VALUES ($1, $2, $3, $4)', [id, org.company.id, type, '{}'])
  const outbox = new PostgresOutboxAdapter()
  const claims = await Promise.all([outbox.claim([type]), outbox.claim([type])])
  expect(claims.filter(Boolean)).toHaveLength(1)
  const first = claims.find((claim) => claim !== null)!
  await db().query("UPDATE outbox_events SET next_attempt_at = now() - interval '1 second' WHERE id = $1", [id])
  const second = (await outbox.claim([type]))!
  expect(second.attempts).toBe(2)
  expect(second.leaseToken).not.toBe(first.leaseToken)
  const work = new PostgresReceiptAnalysisWork()
  await work.finish(first, null, undefined, 'VALIDATION_ERROR')
  const pending = await db().query('SELECT status, lease_token FROM outbox_events WHERE id = $1', [id])
  expect(pending.rows[0]).toMatchObject({ status: 'pending', lease_token: second.leaseToken })
  await work.finish(second, null, undefined, 'VALIDATION_ERROR')
  expect((await db().query('SELECT status FROM outbox_events WHERE id = $1', [id])).rows[0].status).toBe('dead')
})

test('[OCR-18] three engine failures lead to a durable failed analysis and a dead event', async ({ org, apiAs }) => {
  const analysisId = randomUUID(), eventId = randomUUID(), type = `test.receipt.${randomUUID()}`
  const payload = { version: 1 as const, analysisId, userId: org.employee.id, companyId: org.company.id,
    receiptKey: `receipts/${org.company.id}/analyses/${analysisId}` }
  await db().query(
    `INSERT INTO receipt_analyses (id, user_id, company_id, receipt_key, mime_type, fingerprint, idempotency_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [analysisId, org.employee.id, org.company.id, payload.receiptKey, 'image/png', 'failure-fixture', randomUUID()]
  )
  await db().query('INSERT INTO outbox_events (id, company_id, type, payload) VALUES ($1, $2, $3, $4)',
    [eventId, org.company.id, type, JSON.stringify(payload)])
  const work = new PostgresReceiptAnalysisWork(), outbox = new PostgresOutboxAdapter()
  for (let attempt = 1; attempt <= 3; attempt++) {
    const event = (await outbox.claim([type]))!
    expect(event.attempts).toBe(attempt)
    expect(await work.start(event, payload)).toBe('image/png')
    await work.finish(event, payload, undefined, 'OCR_UNAVAILABLE')
    const row = (await db().query('SELECT status FROM receipt_analyses WHERE id = $1', [analysisId])).rows[0]
    expect(row.status).toBe(attempt < 3 ? 'queued' : 'failed')
    await db().query("UPDATE outbox_events SET next_attempt_at = now() - interval '1 second' WHERE id = $1", [eventId])
  }
  expect((await db().query('SELECT status FROM outbox_events WHERE id = $1', [eventId])).rows[0].status).toBe('dead')
  const api = await apiAs(org.employee)
  const response = await api.request.get(`/api/receipt-analyses/${analysisId}`)
  expect(response.status()).toBe(200)
  expect(await response.json()).toMatchObject({ status: 'failed', error: { code: 'OCR_UNAVAILABLE', status: 503 } })
})

test('[OCR-19] database execution slots admit only two independent consumers', async ({ org }) => {
  const release = Promise.withResolvers<void>()
  let entered = 0, active = 0, peak = 0
  const signal = AbortSignal.timeout(10_000)
  const consumers = [1, 2, 3].map(() => withOcrExecution(org.employee.id, signal, async () => {
    entered++
    active++
    peak = Math.max(peak, active)
    await release.promise
    active--
  }))
  try {
    await expect.poll(() => entered).toBe(2)
    expect(active).toBe(2)
  } finally {
    release.resolve()
    await Promise.all(consumers)
  }
  expect(entered).toBe(3)
  expect(peak).toBe(2)
})
