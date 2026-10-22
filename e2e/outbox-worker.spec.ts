import { randomUUID } from 'node:crypto'
import { PgEventOutbox } from '@/adapters/PgEventOutbox'
import { closePool, withSystemTransaction, withUserScope } from '@/lib/db'
import { expect, test } from './support/fixtures'
import { outboxEvent } from './support/outbox'

test.afterAll(closePool)

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
