import { randomUUID } from 'node:crypto'
import { createEmailSender } from '@/lib/email'
import { expect, test } from './support/fixtures'
import { waitForEmail } from './support/mailpit'

test.describe('Envoi d’emails — intégration SMTP', () => {
  test('[MAIL-01] un email envoyé par l’adaptateur SMTP arrive dans Mailpit', async ({ request }) => {
    const to = `mail-01.${randomUUID().slice(0, 8)}@mail.e2e.test`
    const messageId = `<mail-01.${randomUUID()}@expense.io>`
    await createEmailSender(process.env).send({ to, subject: 'Test Expense.io', text: 'Bonjour depuis Expense.io', messageId })

    const message = await waitForEmail(request, to)
    expect(message.Subject).toBe('Test Expense.io')
    expect(message.Text).toContain('Bonjour depuis Expense.io')
    expect(message.From.Address).toBe('no-reply@expense.io')
    expect(`<${message.MessageID}>`).toBe(messageId)
  })
})
