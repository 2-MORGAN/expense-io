import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { EmailNotificationAdapter } from '@/modules/expenses/adapters/EmailNotificationAdapter'
import { SmtpEmailAdapter } from './SmtpEmailAdapter'
import { createEmailSender } from '@/lib/email'
import { waitForEmail } from '../../integration/support/mailpit'

// Envoi réel par SMTP vers le Mailpit de docker-compose.yml (aucun email ne
// sort) : configuration lue dans l'environnement comme le worker, puis
// notification complète jusqu'à la boîte du destinataire.

const address = (label: string) => `${label}.${randomUUID().slice(0, 8)}@integration.test`

describe('SmtpEmailAdapter', () => {
  it('remet l’email au serveur SMTP : expéditeur configuré, sujet, texte et Message-ID', async () => {
    const to = address('smtp')
    const messageId = `<integration-${randomUUID()}@expense.io>`
    await createEmailSender(process.env).send({ to, subject: 'Sujet intégration', text: 'Corps du message', messageId })
    const mail = await waitForEmail(to)
    expect(mail).toMatchObject({ Subject: 'Sujet intégration', MessageID: messageId.slice(1, -1), From: { Address: 'no-reply@expense.io' } })
    expect(mail.Text.trim()).toBe('Corps du message')
  })

  it('serveur injoignable : l’envoi échoue (le worker relancera l’événement)', async () => {
    const unreachable = SmtpEmailAdapter.fromConfig({ host: '127.0.0.1', port: 1, secure: false, from: 'Expense.io <no-reply@expense.io>' })
    await expect(unreachable.send({ to: address('panne'), subject: 's', text: 't' })).rejects.toThrow()
  })
})

describe('EmailNotificationAdapter par SMTP', () => {
  it('note soumise : un email par approbateur, avec le lien de son espace, Message-ID stable par destinataire', async () => {
    const notifier = new EmailNotificationAdapter(createEmailSender(process.env), 'http://localhost:3000/')
    const manager = { id: randomUUID(), email: address('manager'), name: 'Marie', role: 'manager' as const }
    const hr = { id: randomUUID(), email: address('rh'), name: 'Hugo', role: 'hr_admin' as const }
    const eventId = randomUUID()
    await notifier.notifySubmitted([manager, hr], { id: randomUUID(), description: 'Taxi gare', submitterName: 'Emile' }, eventId)

    const toManager = await waitForEmail(manager.email)
    expect(toManager.Subject).toBe('Nouvelle note de frais à valider')
    expect(toManager.Text).toContain('Emile a soumis une note de frais : « Taxi gare »')
    expect(toManager.Text).toContain('http://localhost:3000/manager')
    expect(toManager.MessageID).toBe(`${eventId}.${manager.id}@expense.io`)
    expect((await waitForEmail(hr.email)).Text).toContain('http://localhost:3000/hr')
  })
})
