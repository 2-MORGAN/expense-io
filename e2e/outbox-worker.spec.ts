import { randomUUID } from 'node:crypto'
import { PgEventOutbox } from '@/adapters/PgEventOutbox'
import { closePool, withSystemTransaction, withUserScope } from '@/lib/db'
import { LEASE_SECONDS, leaseNextDueEvent } from '@/lib/outbox'
import { handleLeasedEvent, processNextEvent, type OutboxHandler } from '@/worker/processNextEvent'
import { createCompany, db } from './support/db'
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

test.describe('Outbox — arrêt du worker', () => {
  test('[OUTBOX-09] worker arrêté pendant le traitement : l’essai compte, puis l’événement finit en dead', async () => {
    const company = await createCompany('outbox-09')

    // (a) Prise en charge seule (phase 1), sans phase 2 : un worker tué juste après.
    const leasedType = `test.${randomUUID()}`
    const leasedId = await insertOutboxEvent({ companyId: company.id, type: leasedType })
    const leased = await leaseNextDueEvent([leasedType], company.id)
    expect(leased).toMatchObject({ id: leasedId, attempts: 1 })
    const row = await outboxEvent(leasedId)
    expect(row).toMatchObject({ status: 'pending', attempts: 1 })
    // Horloge de la base, comme OUTBOX-04.
    const { rows } = await db().query<{ lease: number }>(
      'SELECT extract(epoch FROM $1::timestamptz - clock_timestamp())::float8 AS lease', [row.nextAttemptAt])
    expect(LEASE_SECONDS).toBe(300)
    expect(rows[0].lease).toBeGreaterThan(290)
    expect(rows[0].lease).toBeLessThan(310)

    // (b) Six essais déjà faits (1 + 5 relances) dont le dernier n'a jamais fini : mort sans handler.
    const deadType = `test.${randomUUID()}`
    const deadId = await insertOutboxEvent({
      companyId: company.id, type: deadType, attempts: 6, nextAttemptAt: new Date(Date.now() - 1000),
    })
    let calls = 0
    expect(await processNextEvent(only(deadType, async () => { calls += 1 }), { companyId: company.id })).toBe(true)
    expect(calls).toBe(0)
    expect(await outboxEvent(deadId)).toMatchObject({ status: 'dead', attempts: 7, lastError: expect.stringMatching(/did not finish/) })
  })

  test('[OUTBOX-10] prise en charge périmée : un autre worker a repris l’événement, la phase 2 n’agit pas', async () => {
    const company = await createCompany('outbox-10')
    const type = `test.${randomUUID()}`
    const id = await insertOutboxEvent({ companyId: company.id, type })
    const stale = await leaseNextDueEvent([type], company.id)
    expect(stale).toMatchObject({ id, attempts: 1 })
    // Un autre worker a repris l'événement après l'expiration du bail.
    await db().query('UPDATE outbox_events SET attempts = 2 WHERE id = $1', [id])
    const before = await outboxEvent(id)

    let calls = 0
    await handleLeasedEvent(only(type, async () => { calls += 1 }), stale!)
    expect(calls).toBe(0)
    expect(await outboxEvent(id)).toEqual(before)
  })
})
