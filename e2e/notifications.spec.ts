import { EmailNotificationAdapter } from '@/adapters/EmailNotificationAdapter'
import { closePool } from '@/lib/db'
import { createEmailSender } from '@/lib/email'
import type { NotificationPort } from '@/ports/NotificationPort'
import { notificationHandlers } from '@/worker/notificationHandlers'
import { processNextEvent } from '@/worker/processNextEvent'
import { expectApiError, statusOf, UNKNOWN_ID } from './support/api'
import { addUser, createOrg, expect, test } from './support/fixtures'
import { countEmails, waitForEmail } from './support/mailpit'
import { insertOutboxEvent, outboxEvent, outboxEventsForNote } from './support/outbox'

test.afterAll(closePool)

const realNotifier = () => new EmailNotificationAdapter(createEmailSender(process.env), 'http://localhost:3000')

// Traite les événements de l'entreprise (et d'elle seule : les tests tournent en parallèle).
async function drain(companyId: string, notifier: NotificationPort = realNotifier()) {
  const handlers = notificationHandlers(notifier)
  while (await processNextEvent(handlers, { companyId })) { /* jusqu’à épuisement */ }
}

test.describe('Notifications — émission', () => {
  test('[NOTIF-01] soumission d’un employé → un événement pour son manager', async ({ org, apiAs }) => {
    const note = await (await apiAs(org.employee)).submitNote({ description: 'Taxi gare' })
    expect(await outboxEventsForNote(note.id)).toMatchObject([{
      type: 'expense_note.submitted', companyId: org.company.id, status: 'pending',
      payload: { noteId: note.id, description: 'Taxi gare', submitterName: 'Emile Employe', recipientIds: [org.manager.id] },
    }])
  })

  test('[NOTIF-02] soumission d’un manager racine → toutes les RH de l’entreprise', async ({ org, apiAs }) => {
    const hr2 = await addUser(org, { name: 'Helene Rh', role: 'hr_admin' })
    const note = await (await apiAs(org.manager)).submitNote({ description: 'Hôtel' })
    const [event] = await outboxEventsForNote(note.id)
    expect((event.payload.recipientIds as string[]).sort()).toEqual([org.hr.id, hr2.id].sort())
  })

  test('[NOTIF-03] soumetteur sans approbateur → note créée, aucun événement', async ({ org, apiAs }) => {
    const alone = await addUser(org, { name: 'Sans Manager', role: 'employee', managerId: null })
    const note = await (await apiAs(alone)).submitNote({ description: 'Repas' })
    expect(await outboxEventsForNote(note.id)).toEqual([])
  })

  test('[NOTIF-04] décision du manager → un seul événement, même après des décisions répétées', async ({ org, apiAs }) => {
    const note = await (await apiAs(org.employee)).submitNote({ description: 'Train' })
    const managerApi = await apiAs(org.manager)
    expect((await managerApi.managerDecide(note.id, 'approve')).status()).toBe(200)
    await expectApiError(await managerApi.managerDecide(note.id, 'approve'), 409, 'Already decided')
    await expectApiError(await managerApi.managerDecide(note.id, 'reject'), 409, 'Already decided')

    const decided = (await outboxEventsForNote(note.id)).filter((event) => event.type === 'expense_note.decided')
    expect(decided).toMatchObject([{ payload: { noteId: note.id, description: 'Train', decision: 'approved', recipientIds: [org.employee.id] } }])
  })

  test('[NOTIF-05] rejet par la RH d’une note de manager racine → événement pour le manager', async ({ org, apiAs }) => {
    const note = await (await apiAs(org.manager)).submitNote({ description: 'Salon' })
    expect((await (await apiAs(org.hr)).hrDecide(note.id, 'reject')).status()).toBe(200)
    const decided = (await outboxEventsForNote(note.id)).filter((event) => event.type === 'expense_note.decided')
    expect(decided).toMatchObject([{ payload: { decision: 'rejected', recipientIds: [org.manager.id] } }])
  })
})

test.describe('Notifications — envoi par le worker', () => {
  test('[NOTIF-06] note soumise → email au manager, sans montant', async ({ org, apiAs, request }) => {
    const note = await (await apiAs(org.employee)).submitNote({ description: 'Taxi gare', amount: '18.40' })
    await drain(org.company.id)
    const mail = await waitForEmail(request, org.manager.email)
    expect(mail.Subject).toBe('Nouvelle note de frais à valider')
    expect(mail.Text).toContain('« Taxi gare »')
    expect(mail.Text).toContain('http://localhost:3000/manager')
    expect(mail.Text).not.toMatch(/18[.,]40/)
    const [event] = await outboxEventsForNote(note.id)
    expect(mail.MessageID).toBe(`${event.id}.${org.manager.id}@expense.io`)
    expect(event.status).toBe('sent')
  })

  test('[NOTIF-07] note approuvée → email au soumetteur', async ({ org, apiAs, request }) => {
    const note = await (await apiAs(org.employee)).submitNote({ description: 'Train' })
    await (await apiAs(org.manager)).managerDecide(note.id, 'approve')
    await drain(org.company.id)
    const mail = await waitForEmail(request, org.employee.email)
    expect(mail.Subject).toBe('Votre note de frais a été approuvée')
    expect(mail.Text).toContain('http://localhost:3000/expenses')
  })

  test('[NOTIF-08] destinataire d’une autre entreprise dans le payload → écarté', async ({ org, request }) => {
    const other = await createOrg('autre-entreprise')
    const id = await insertOutboxEvent({
      companyId: org.company.id, type: 'expense_note.decided',
      payload: { noteId: UNKNOWN_ID, description: 'Forgée', decision: 'approved', recipientIds: [org.employee.id, other.employee.id] },
    })
    await drain(org.company.id)
    await waitForEmail(request, org.employee.email)
    expect(await countEmails(request, other.employee.email)).toBe(0)
    expect((await outboxEvent(id)).status).toBe('sent')
  })

  test('[NOTIF-09] envoi en panne → décision acquise, email reprogrammé', async ({ org, apiAs }) => {
    const employeeApi = await apiAs(org.employee)
    const note = await employeeApi.submitNote({ description: 'Parking' })
    expect((await (await apiAs(org.manager)).managerDecide(note.id, 'approve')).status()).toBe(200)
    const failing: NotificationPort = {
      notifySubmitted: async () => { throw new Error('SMTP indisponible') },
      notifyDecision: async () => { throw new Error('SMTP indisponible') },
    }
    await drain(org.company.id, failing)

    expect(await statusOf(employeeApi, note.id)).toBe('approved')
    const decided = (await outboxEventsForNote(note.id)).find((event) => event.type === 'expense_note.decided')
    expect(decided).toMatchObject({ status: 'pending', attempts: 1, lastError: 'SMTP indisponible' })
  })
})
