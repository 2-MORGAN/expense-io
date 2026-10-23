import { randomUUID } from 'node:crypto'
import { PgEventOutbox } from '@/adapters/PgEventOutbox'
import { closePool, withSystemTransaction, withUserScope } from '@/lib/db'
import { processNextEvent, type OutboxHandler } from '@/worker/processNextEvent'
import { createCompany } from './support/db'
import { expect, test } from './support/fixtures'
import { insertOutboxEvent, outboxEvent } from './support/outbox'

test.afterAll(closePool)

function only(type: string, handle: OutboxHandler['handle'], maxRetries = 5) {
  return { [type]: { maxRetries, handle } }
}

test.describe('Outbox — publication', () => {
  test('[OUTBOX-01] enqueue dans withUserScope : événement « pending » dans l’entreprise de l’utilisateur', async ({ org }) => {
    const type = `test.outbox-01.${randomUUID()}`
    const id = await withUserScope(org.employee.id, (client) =>
      new PgEventOutbox(client).enqueue({ type, payload: { hello: 'world' } }))
    expect(await outboxEvent(id)).toMatchObject({
      companyId: org.company.id, type, payload: { hello: 'world' }, status: 'pending', attempts: 0, lastError: null,
    })
  })

  test('[OUTBOX-02] enqueue hors contexte utilisateur : refusé, rien n’est écrit', async () => {
    await expect(withSystemTransaction((client) =>
      new PgEventOutbox(client).enqueue({ type: 'test.outbox-02', payload: {} }))).rejects.toThrow(/company_id/)
  })
})

test.describe('Outbox — traitement par le worker', () => {
  test('[OUTBOX-03] succès → « sent », 1 essai, traité une seule fois', async () => {
    const company = await createCompany('outbox-03')
    const type = `test.${randomUUID()}`
    const id = await insertOutboxEvent({ companyId: company.id, type, payload: { n: 1 } })
    const seen: string[] = []
    const handlers = only(type, async (event) => { seen.push(event.id) })

    expect(await processNextEvent(handlers, { companyId: company.id })).toBe(true)
    expect(await processNextEvent(handlers, { companyId: company.id })).toBe(false)
    expect(seen).toEqual([id])
    expect(await outboxEvent(id)).toMatchObject({ status: 'sent', attempts: 1, lastError: null })
  })

  test('[OUTBOX-04] échec → relance dans 1 min, écritures du handler annulées, email masqué', async () => {
    const company = await createCompany('outbox-04')
    const type = `test.${randomUUID()}`
    const id = await insertOutboxEvent({ companyId: company.id, type, payload: { original: true } })
    // Horloge de la base : le délai de relance se mesure depuis l'échec, pas depuis le début de la transaction.
    let failedAt = 0
    const handlers = only(type, async (event, client) => {
      await client.query(`UPDATE outbox_events SET payload = '{"touched": true}' WHERE id = $1`, [event.id])
      const { rows } = await client.query<{ at: Date }>('SELECT clock_timestamp() AS at')
      failedAt = rows[0].at.getTime()
      throw new Error('SMTP indisponible pour jane@acme.test')
    })
    const before = Date.now()

    expect(await processNextEvent(handlers, { companyId: company.id })).toBe(true)
    const row = await outboxEvent(id)
    expect(row).toMatchObject({
      status: 'pending', attempts: 1, payload: { original: true }, lastError: 'SMTP indisponible pour [email]',
    })
    expect(row.nextAttemptAt.getTime() - before).toBeGreaterThan(50_000)
    expect(row.nextAttemptAt.getTime() - before).toBeLessThan(70_000)
    expect(row.nextAttemptAt.getTime() - failedAt).toBeGreaterThanOrEqual(60_000)
    expect(await processNextEvent(handlers, { companyId: company.id })).toBe(false)
  })

  test('[OUTBOX-05] échec après 5 relances → « dead »', async () => {
    const company = await createCompany('outbox-05')
    const type = `test.${randomUUID()}`
    const id = await insertOutboxEvent({ companyId: company.id, type, attempts: 5 })
    await processNextEvent(only(type, async () => { throw new Error('toujours en panne') }), { companyId: company.id })
    expect(await outboxEvent(id)).toMatchObject({ status: 'dead', attempts: 6, lastError: 'toujours en panne' })
  })

  test('[OUTBOX-06] événement pas encore dû : ignoré', async () => {
    const company = await createCompany('outbox-06')
    const type = `test.${randomUUID()}`
    const id = await insertOutboxEvent({ companyId: company.id, type, nextAttemptAt: new Date(Date.now() + 3_600_000) })
    let calls = 0
    expect(await processNextEvent(only(type, async () => { calls += 1 }), { companyId: company.id })).toBe(false)
    expect(calls).toBe(0)
    expect(await outboxEvent(id)).toMatchObject({ status: 'pending', attempts: 0 })
  })

  test('[OUTBOX-07] deux workers simultanés : l’événement est traité une seule fois', async () => {
    const company = await createCompany('outbox-07')
    const type = `test.${randomUUID()}`
    const id = await insertOutboxEvent({ companyId: company.id, type })
    let calls = 0
    const handlers = only(type, async () => { calls += 1; await new Promise((resolve) => setTimeout(resolve, 300)) })

    const results = await Promise.all([
      processNextEvent(handlers, { companyId: company.id }),
      processNextEvent(handlers, { companyId: company.id }),
    ])
    expect(results.sort()).toEqual([false, true])
    expect(calls).toBe(1)
    expect(await outboxEvent(id)).toMatchObject({ status: 'sent', attempts: 1 })
  })

  test('[OUTBOX-08] type sans handler : laissé « pending » pour le worker qui le connaît', async () => {
    const company = await createCompany('outbox-08')
    const id = await insertOutboxEvent({ companyId: company.id, type: `test.unhandled.${randomUUID()}` })
    expect(await processNextEvent(only(`test.${randomUUID()}`, async () => {}), { companyId: company.id })).toBe(false)
    expect(await outboxEvent(id)).toMatchObject({ status: 'pending', attempts: 0 })
  })
})
