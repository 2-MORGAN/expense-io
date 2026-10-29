import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { PgEventOutbox } from './PgEventOutbox'
import { findCompanyRecipients } from '@/modules/expenses/adapters/PgNotificationEvents'
import { withUserScope } from '@/lib/db'
import { scopeToCompany } from '@/lib/outbox'
import { eventsOfCompany } from '../../integration/support/outbox'
import { createTenant } from '../../integration/support/tenant'
import { asWorker } from '../../integration/support/worker'

// Publication dans la transaction de l'appelant, sous `expense_app` :
// l'entreprise de l'événement est celle de l'utilisateur du contexte, jamais
// une valeur venue de l'appelant. Le filtre des destinataires, lui, tourne
// dans la transaction du worker.

describe('PgEventOutbox.enqueue', () => {
  it('écrit l’événement « pending » dans l’entreprise de l’utilisateur courant', async () => {
    const { employee, company } = await createTenant('outbox')
    const type = `test.integration.${randomUUID()}`
    const id = await withUserScope(employee.id, (client) => new PgEventOutbox(client).enqueue({ type, payload: { a: 1 } }))
    expect(await eventsOfCompany(company.id)).toEqual([{ id, companyId: company.id, type, payload: { a: 1 }, status: 'pending' }])
  })

  it('n’existe que si la transaction est validée', async () => {
    const { employee, company } = await createTenant('outbox-annulee')
    await expect(
      withUserScope(employee.id, async (client) => {
        await new PgEventOutbox(client).enqueue({ type: 'test.integration.annule', payload: {} })
        throw new Error('écriture métier en échec')
      })
    ).rejects.toThrow('écriture métier en échec')
    expect(await eventsOfCompany(company.id)).toEqual([])
  })

  it('hors contexte d’un utilisateur connu : refusé, rien n’est écrit', async () => {
    await expect(
      withUserScope(randomUUID(), (client) => new PgEventOutbox(client).enqueue({ type: 'test.integration.orphelin', payload: {} }))
    ).rejects.toMatchObject({ code: expect.stringMatching(/^(23502|42501)$/) })
  })

  it('l’application n’a que l’INSERT : relire l’outbox lui est refusé (42501)', async () => {
    const { employee } = await createTenant('outbox-lecture')
    await expect(withUserScope(employee.id, (client) => client.query('SELECT id FROM outbox_events LIMIT 1'))).rejects.toMatchObject({
      code: '42501',
    })
  })
})

describe('findCompanyRecipients', () => {
  it('ne rend que les destinataires de l’entreprise de l’événement : un id d’une autre entreprise ou inconnu est écarté', async () => {
    const a = await createTenant('destinataires-a')
    const b = await createTenant('destinataires-b')
    const recipients = await asWorker(async (client) => {
      await scopeToCompany(client, a.company.id)
      return findCompanyRecipients(client, a.company.id, [a.employee.id, b.employee.id, randomUUID()])
    })
    expect(recipients).toEqual([{ id: a.employee.id, email: a.employee.email, name: 'Emile Employe', role: 'employee' }])
  })
})
