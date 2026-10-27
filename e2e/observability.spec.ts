import { randomUUID } from 'node:crypto'
import { closePool } from '@/lib/db'
import { outboxStats } from '@/lib/outbox'
import { db } from './support/db'
import { expect, test } from './support/fixtures'
import { insertOutboxEvent } from './support/outbox'

// Métriques de l'outbox (ADR-003 §6, Q5) : ce que le worker journalise chaque
// minute (`outbox.stats`), lu en base comme le fait `expense_worker`.

test.afterAll(closePool)

test('[OBS-01] outbox : en attente, morts (DLQ) et âge du plus ancien en attente, par type', async ({ org }) => {
  const type = `test.obs-01.${randomUUID()}`
  const old = await insertOutboxEvent({ companyId: org.company.id, type })
  await insertOutboxEvent({ companyId: org.company.id, type })
  const dead = await insertOutboxEvent({ companyId: org.company.id, type })
  const sent = await insertOutboxEvent({ companyId: org.company.id, type })
  await db().query(`UPDATE outbox_events SET created_at = now() - interval '120 seconds' WHERE id = $1`, [old])
  await db().query(`UPDATE outbox_events SET status = 'dead', created_at = now() - interval '1 day' WHERE id = $1`, [dead])
  await db().query(`UPDATE outbox_events SET status = 'sent' WHERE id = $1`, [sent])

  const stats = (await outboxStats()).find((row) => row.type === type)
  expect(stats).toMatchObject({ pending: 2, dead: 1 })
  // L'événement mort, plus ancien, ne compte pas dans l'âge de la file d'attente.
  expect(stats?.oldestPendingAgeSeconds).toBeGreaterThanOrEqual(120)
  expect(stats?.oldestPendingAgeSeconds).toBeLessThan(3600)
})
