import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { PostgresReceiptAnalysisWork } from './PostgresReceiptAnalysisWork'
import type { OutboxEventRecord } from '@/ports/EventOutbox'
import type { AnalysisPayload } from '@/ports/ReceiptAnalysisWorkPort'
import { createTenant, owner, type Tenant } from '../../integration/support/tenant'
import { connectAsWorker } from '../../integration/support/worker'

// Écritures du worker sur une analyse OCR, sous `expense_worker` comme en
// production : chacune n'a lieu que si la prise en charge de l'événement est
// toujours la sienne (même essai, encore en attente). Événements d'un type de
// test unique : aucun worker lancé sur la même base ne les consomme.
connectAsWorker()

const work = new PostgresReceiptAnalysisWork()

async function analysisWithEvent(tenant: Tenant, attempts = 1) {
  const analysisId = randomUUID()
  const payload: AnalysisPayload = {
    version: 1,
    analysisId,
    userId: tenant.employee.id,
    companyId: tenant.company.id,
    receiptKey: `receipts/${tenant.company.id}/analyses/${analysisId}`,
  }
  await owner().query(
    `INSERT INTO receipt_analyses (id, user_id, company_id, receipt_key, mime_type, fingerprint, idempotency_key)
     VALUES ($1, $2, $3, $4, 'image/png', 'empreinte', $5)`,
    [analysisId, tenant.employee.id, tenant.company.id, payload.receiptKey, randomUUID()]
  )
  const event = await owner().query<{ id: string; created_at: Date }>(
    'INSERT INTO outbox_events (company_id, type, payload, attempts) VALUES ($1, $2, $3, $4) RETURNING id, created_at',
    [tenant.company.id, `test.integration.receipt.${randomUUID()}`, JSON.stringify(payload), attempts]
  )
  const record: OutboxEventRecord = {
    id: event.rows[0].id,
    companyId: tenant.company.id,
    type: 'test.integration.receipt',
    payload: { ...payload },
    attempts,
    createdAt: event.rows[0].created_at,
  }
  return { payload, record }
}

async function analysis(id: string) {
  const result = await owner().query<{ status: string; result: unknown; error_code: string | null; receipt_deleted: boolean }>(
    'SELECT status, result, error_code, receipt_deleted FROM receipt_analyses WHERE id = $1',
    [id]
  )
  return result.rows[0]
}

describe('start et finish', () => {
  it('prend l’analyse en charge, puis enregistre son résultat ; une reprise la trouve terminée', async () => {
    const { payload, record } = await analysisWithEvent(await createTenant('travail-ocr'))
    expect(await work.start(record, payload)).toEqual({ kind: 'run', mimeType: 'image/png' })
    expect((await analysis(payload.analysisId)).status).toBe('running')

    expect(await work.finish(record, payload, { status: 'succeeded', result: { amount: 42.5, expenseDate: '2026-10-11' } })).toBe(true)
    expect(await analysis(payload.analysisId)).toMatchObject({ status: 'succeeded', result: { amount: 42.5, expenseDate: '2026-10-11' } })
    expect(await work.start(record, payload)).toEqual({ kind: 'done' })
  })

  it('un échec définitif garde son code d’erreur ; une relance remet l’analyse en attente', async () => {
    const tenant = await createTenant('travail-ocr-echec')
    const failed = await analysisWithEvent(tenant)
    await work.start(failed.record, failed.payload)
    expect(await work.finish(failed.record, failed.payload, { status: 'failed', errorCode: 'OCR_TIMEOUT' })).toBe(true)
    expect(await analysis(failed.payload.analysisId)).toMatchObject({ status: 'failed', error_code: 'OCR_TIMEOUT', result: null })

    const retried = await analysisWithEvent(tenant)
    await work.start(retried.record, retried.payload)
    expect(await work.finish(retried.record, retried.payload, { status: 'queued' })).toBe(true)
    expect((await analysis(retried.payload.analysisId)).status).toBe('queued')
  })

  it('consommateur périmé (un autre worker a repris l’événement) : rien n’est écrit', async () => {
    const { payload, record } = await analysisWithEvent(await createTenant('travail-ocr-perime'))
    await owner().query('UPDATE outbox_events SET attempts = attempts + 1 WHERE id = $1', [record.id])
    expect(await work.start(record, payload)).toEqual({ kind: 'missing' })
    expect(await work.finish(record, payload, { status: 'succeeded', result: { amount: 1 } })).toBe(false)
    expect((await analysis(payload.analysisId)).status).toBe('queued')
  })

  it('payload qui désigne une autre entreprise, ou analyse expirée : missing', async () => {
    const tenant = await createTenant('travail-ocr-autre')
    const forged = await analysisWithEvent(tenant)
    const elsewhere = await createTenant('travail-ocr-autre-b')
    expect(await work.start(forged.record, { ...forged.payload, companyId: elsewhere.company.id })).toEqual({ kind: 'missing' })

    const expired = await analysisWithEvent(tenant)
    await owner().query("UPDATE receipt_analyses SET expires_at = now() - interval '1 second' WHERE id = $1", [expired.payload.analysisId])
    expect(await work.start(expired.record, expired.payload)).toEqual({ kind: 'missing' })
  })
})

describe('nettoyage', () => {
  it('cleanupCandidates ne rend que des analyses terminées dont le reçu reste à supprimer', async () => {
    const { payload, record } = await analysisWithEvent(await createTenant('travail-ocr-candidats'))
    await work.start(record, payload)
    await work.finish(record, payload, { status: 'succeeded', result: {} })
    const candidates = await work.cleanupCandidates()
    for (const candidate of candidates) {
      expect(await analysis(candidate.id)).toMatchObject({ status: expect.stringMatching(/^(succeeded|failed)$/), receipt_deleted: false })
    }
  })

  it('markDeleted marque le reçu supprimé ; purgeExpired retire les analyses expirées dont le reçu est supprimé, pas les autres', async () => {
    const tenant = await createTenant('travail-ocr-purge')
    const purged = await analysisWithEvent(tenant)
    const kept = await analysisWithEvent(tenant)
    await work.markDeleted(purged.payload.analysisId, tenant.employee.id)
    expect((await analysis(purged.payload.analysisId)).receipt_deleted).toBe(true)
    await owner().query("UPDATE receipt_analyses SET expires_at = now() - interval '1 second' WHERE id = ANY($1::uuid[])", [
      [purged.payload.analysisId, kept.payload.analysisId],
    ])
    await work.purgeExpired()
    expect(await analysis(purged.payload.analysisId)).toBeUndefined()
    expect(await analysis(kept.payload.analysisId)).toMatchObject({ receipt_deleted: false })
  })
})
