import { randomUUID } from 'node:crypto'
import { test, expect } from './support/fixtures'
import { db } from './support/db'
import { insertOutboxEvent, outboxEvent } from './support/outbox'
import { pngReceipt } from './support/files'
import { closePool } from '@/lib/db'
import { leaseNextDueEvent } from '@/lib/outbox'
import { PostgresReceiptAnalysisWork } from '@/modules/receipt-analysis/adapters/PostgresReceiptAnalysisWork'
import { withOcrExecution } from '@/modules/receipt-analysis/adapters/PostgresOcrExecution'
import { OcrCapacity } from '@/modules/receipt-analysis/application/OcrCapacity'
import { SuggestReceiptFields } from '@/modules/receipt-analysis/application/SuggestReceiptFields'
import { ANALYSIS_BACKOFF_SECONDS, MAX_ANALYSIS_ATTEMPTS, ProcessReceiptAnalysis } from '@/modules/receipt-analysis/application/ProcessReceiptAnalysis'
import { OcrError } from '@/modules/receipt-analysis/domain/OcrError'
import { processNextEvent } from '@/worker/processNextEvent'

// L'analyse des reçus tourne sur le socle commun de l'outbox (2-484, ADR-003
// amendement du 23/10 §2). Chaque test utilise un type d'événement unique : le
// worker de l'application ne le consomme pas.

test.afterAll(closePool)

async function insertAnalysis(org: { company: { id: string }; employee: { id: string } }) {
  const analysisId = randomUUID()
  const payload = { version: 1 as const, analysisId, userId: org.employee.id, companyId: org.company.id,
    receiptKey: `receipts/${org.company.id}/analyses/${analysisId}` }
  await db().query(
    `INSERT INTO receipt_analyses (id, user_id, company_id, receipt_key, mime_type, fingerprint, idempotency_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [analysisId, org.employee.id, org.company.id, payload.receiptKey, 'image/png', 'fixture', randomUUID()]
  )
  return payload
}

async function analysisStatus(id: string): Promise<string> {
  return (await db().query('SELECT status FROM receipt_analyses WHERE id = $1', [id])).rows[0].status
}

async function makeDue(id: string) {
  await db().query("UPDATE outbox_events SET next_attempt_at = now() - interval '1 second' WHERE id = $1", [id])
}

test('[OCR-17] expired outbox lease is reclaimable and a stale consumer writes nothing', async ({ org }) => {
  const type = `test.receipt.${randomUUID()}`
  const payload = await insertAnalysis(org)
  const eventId = await insertOutboxEvent({ companyId: org.company.id, type, payload })

  const claims = await Promise.all([leaseNextDueEvent([type]), leaseNextDueEvent([type])])
  expect(claims.filter(Boolean)).toHaveLength(1)
  const first = claims.find((claim) => claim !== null)!
  await makeDue(eventId)
  const second = (await leaseNextDueEvent([type]))!
  expect(second.attempts).toBe(first.attempts + 1)

  const work = new PostgresReceiptAnalysisWork()
  expect(await work.start(first, payload)).toEqual({ kind: 'missing' })
  expect(await work.finish(first, payload, { status: 'succeeded', result: { amount: 1 } })).toBe(false)
  expect(await analysisStatus(payload.analysisId)).toBe('queued')

  expect(await work.start(second, payload)).toEqual({ kind: 'run', mimeType: 'image/png' })
  expect(await work.finish(second, payload, { status: 'succeeded', result: { amount: 42.5 } })).toBe(true)
  expect(await analysisStatus(payload.analysisId)).toBe('succeeded')
})

test('[OCR-18] three engine failures lead to a durable failed analysis and a dead event', async ({ org, apiAs }) => {
  const type = `test.receipt.${randomUUID()}`
  const payload = await insertAnalysis(org)
  const eventId = await insertOutboxEvent({ companyId: org.company.id, type, payload })

  const failingOcr = { recognize: async () => { throw new OcrError('OCR_UNAVAILABLE') }, inspect: async () => {} }
  const storage = { upload: async () => {}, read: async () => pngReceipt('ocr-18').buffer, delete: async () => {},
    getSignedUrl: async () => '' }
  const analysis = new ProcessReceiptAnalysis(new PostgresReceiptAnalysisWork(), storage,
    new SuggestReceiptFields(failingOcr), new OcrCapacity(), { run: (_user, _signal, task) => task() })
  const handlers = { [type]: {
    maxRetries: MAX_ANALYSIS_ATTEMPTS - 1,
    backoffSeconds: ANALYSIS_BACKOFF_SECONDS,
    run: (event: Parameters<ProcessReceiptAnalysis['execute']>[0], signal: AbortSignal) => analysis.execute(event, signal),
  } }

  for (let attempt = 1; attempt <= MAX_ANALYSIS_ATTEMPTS; attempt++) {
    expect(await processNextEvent(handlers)).toBe(true)
    expect((await outboxEvent(eventId)).attempts).toBe(attempt)
    expect(await analysisStatus(payload.analysisId)).toBe(attempt < MAX_ANALYSIS_ATTEMPTS ? 'queued' : 'failed')
    await makeDue(eventId)
  }
  expect((await outboxEvent(eventId)).status).toBe('dead')
  expect(await processNextEvent(handlers)).toBe(false)

  const api = await apiAs(org.employee)
  const response = await api.request.get(`/api/receipt-analyses/${payload.analysisId}`)
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
