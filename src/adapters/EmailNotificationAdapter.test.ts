import { describe, expect, it } from 'vitest'
import { EmailNotificationAdapter } from '@/adapters/EmailNotificationAdapter'
import type { EmailMessage } from '@/ports/EmailPort'
import type { Recipient } from '@/ports/NotificationPort'

const APP = 'http://localhost:3000'
const manager: Recipient = { id: 'm1', email: 'marie@acme.test', name: 'Marie', role: 'manager' }
const hr: Recipient = { id: 'h1', email: 'hugo@acme.test', name: 'Hugo', role: 'hr_admin' }
const employee: Recipient = { id: 'u1', email: 'emile@acme.test', name: 'Emile', role: 'employee' }

function collect() {
  const sent: EmailMessage[] = []
  return { sent, port: { send: async (message: EmailMessage) => { sent.push(message) } } }
}

describe('EmailNotificationAdapter', () => {
  it('soumission : un email par approbateur, lien selon son rôle', async () => {
    const { sent, port } = collect()
    await new EmailNotificationAdapter(port, APP).notifySubmitted(
      [manager, hr], { id: 'n1', description: 'Taxi gare', submitterName: 'Emile Employe' }, 'evt-1')
    expect(sent).toEqual([
      { to: 'marie@acme.test', subject: 'Nouvelle note de frais à valider', messageId: '<evt-1.m1@expense.io>',
        text: 'Bonjour,\n\nEmile Employe a soumis une note de frais : « Taxi gare ».\n\nPour la consulter : http://localhost:3000/manager\n' },
      { to: 'hugo@acme.test', subject: 'Nouvelle note de frais à valider', messageId: '<evt-1.h1@expense.io>',
        text: 'Bonjour,\n\nEmile Employe a soumis une note de frais : « Taxi gare ».\n\nPour la consulter : http://localhost:3000/hr\n' },
    ])
  })
  it('soumetteur sans nom → « Un membre de votre équipe »', async () => {
    const { sent, port } = collect()
    await new EmailNotificationAdapter(port, APP).notifySubmitted([manager], { id: 'n1', description: 'Taxi', submitterName: '' }, 'evt-2')
    expect(sent[0].text).toContain('Un membre de votre équipe a soumis')
  })
  it.each([['approved', 'approuvée'], ['rejected', 'rejetée']] as const)('décision %s', async (decision, label) => {
    const { sent, port } = collect()
    await new EmailNotificationAdapter(port, APP).notifyDecision(employee, { id: 'n1', description: 'Taxi gare' }, decision, 'evt-3')
    expect(sent).toEqual([{
      to: 'emile@acme.test', subject: `Votre note de frais a été ${label}`, messageId: '<evt-3.u1@expense.io>',
      text: `Bonjour,\n\nVotre note de frais « Taxi gare » a été ${label}.\n\nPour la consulter : http://localhost:3000/expenses\n`,
    }])
  })
  it('URL de l’application avec slash final → pas de double slash dans le lien', async () => {
    const { sent, port } = collect()
    await new EmailNotificationAdapter(port, `${APP}/`).notifyDecision(employee, { id: 'n1', description: 'Taxi' }, 'approved', 'evt-4')
    expect(sent[0].text).toContain('Pour la consulter : http://localhost:3000/expenses\n')
  })
  it('propage l’échec d’envoi pour que le worker relance', async () => {
    const port = { send: async () => { throw new Error('SMTP down') } }
    await expect(new EmailNotificationAdapter(port, APP).notifyDecision(employee, { id: 'n1', description: 'x' }, 'approved', 'e'))
      .rejects.toThrow('SMTP down')
  })
})
