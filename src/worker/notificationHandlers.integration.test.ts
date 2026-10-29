import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { notificationHandlers } from './notificationHandlers'
import { processNextEvent, type OutboxHandlers } from './processNextEvent'
import { EmailNotificationAdapter } from '@/adapters/EmailNotificationAdapter'
import { EXPENSE_NOTE_DECIDED, EXPENSE_NOTE_SUBMITTED } from '@/domain/Notification'
import { createEmailSender } from '@/lib/email'
import { countEmails, waitForEmail } from '../../integration/support/mailpit'
import { eventState, insertEvent } from '../../integration/support/outbox'
import { createTenant } from '../../integration/support/tenant'
import { connectAsWorker } from '../../integration/support/worker'

// Notifications de soumission et de décision traitées sous `expense_worker`,
// comme en production : destinataires relus dans l'entreprise de l'événement
// seulement, email reçu par Mailpit. Types d'événement uniques, branchés sur
// les vrais handlers.
connectAsWorker()

function handlersFor(kind: typeof EXPENSE_NOTE_SUBMITTED | typeof EXPENSE_NOTE_DECIDED) {
  const type = `test.integration.${kind}.${randomUUID()}`
  const notifier = new EmailNotificationAdapter(createEmailSender(process.env), 'http://localhost:3000')
  const handlers: OutboxHandlers = { [type]: notificationHandlers(notifier)[kind] }
  return { type, handlers }
}

describe('notifications', () => {
  it('note soumise : email au manager avec le lien de son espace, sans montant, événement « sent »', async () => {
    const tenant = await createTenant('worker-soumission')
    const { type, handlers } = handlersFor(EXPENSE_NOTE_SUBMITTED)
    const eventId = await insertEvent({
      companyId: tenant.company.id,
      type,
      payload: { noteId: randomUUID(), description: 'Taxi gare', submitterName: 'Emile Employe', recipientIds: [tenant.manager.id] },
    })
    expect(await processNextEvent(handlers, { companyId: tenant.company.id })).toBe(true)
    const mail = await waitForEmail(tenant.manager.email)
    expect(mail.Text).toContain('Emile Employe a soumis une note de frais : « Taxi gare »')
    expect(mail.Text).toContain('http://localhost:3000/manager')
    expect(mail.MessageID).toBe(`${eventId}.${tenant.manager.id}@expense.io`)
    expect(await eventState(eventId)).toMatchObject({ status: 'sent' })
  })

  it('note tranchée : email au soumetteur ; un destinataire d’une autre entreprise glissé dans le payload est écarté', async () => {
    const tenant = await createTenant('worker-decision')
    const other = await createTenant('worker-decision-b')
    const { type, handlers } = handlersFor(EXPENSE_NOTE_DECIDED)
    const eventId = await insertEvent({
      companyId: tenant.company.id,
      type,
      payload: { noteId: randomUUID(), description: 'Train', decision: 'approved', recipientIds: [tenant.employee.id, other.employee.id] },
    })
    await processNextEvent(handlers, { companyId: tenant.company.id })
    expect((await waitForEmail(tenant.employee.email)).Subject).toBe('Votre note de frais a été approuvée')
    expect(await countEmails(other.employee.email)).toBe(0)
    expect(await eventState(eventId)).toMatchObject({ status: 'sent' })
  })

  it('payload invalide : relance programmée avec l’erreur, aucun email', async () => {
    const tenant = await createTenant('worker-payload')
    const { type, handlers } = handlersFor(EXPENSE_NOTE_SUBMITTED)
    const eventId = await insertEvent({ companyId: tenant.company.id, type, payload: { noteId: 'x' } })
    await processNextEvent(handlers, { companyId: tenant.company.id })
    expect(await eventState(eventId)).toMatchObject({ status: 'pending', attempts: 1, lastError: `invalid payload for ${EXPENSE_NOTE_SUBMITTED}` })
  })
})
