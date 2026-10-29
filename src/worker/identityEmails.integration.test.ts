import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { identityEmailHandlers } from './identityEmails'
import { processNextEvent, type OutboxHandlers } from './processNextEvent'
import { EMAIL_VERIFICATION_REQUESTED, INVITATION_REQUESTED } from '@/domain/identity/identity'
import { createEmailSender } from '@/lib/email'
import { generateToken, hashToken } from '@/lib/tokens'
import type { EmailPort } from '@/ports/EmailPort'
import { countEmails, waitForEmail } from '../../integration/support/mailpit'
import { eventState, insertEvent } from '../../integration/support/outbox'
import { addMember, createTenant, owner, type Tenant } from '../../integration/support/tenant'
import { connectAsWorker } from '../../integration/support/worker'

// Emails d'invitation et de vérification traités par le worker, sous
// `expense_worker` comme en production (les specs E2E l'exécutent sous la
// connexion d'administration) : jeton créé à l'envoi, seule son empreinte en
// base, email reçu par le Mailpit de docker-compose.yml. Types d'événement
// uniques, branchés sur les vrais handlers : un worker lancé sur la même base
// ne les consomme pas.
connectAsWorker()

const APP_URL = 'http://localhost:3000'

function handlersFor(kind: typeof INVITATION_REQUESTED | typeof EMAIL_VERIFICATION_REQUESTED, email: EmailPort = createEmailSender(process.env)) {
  const type = `test.integration.${kind}.${randomUUID()}`
  const handlers: OutboxHandlers = { [type]: identityEmailHandlers(email, APP_URL, generateToken)[kind] }
  return { type, handlers }
}

async function invitationFor(tenant: Tenant, email: string): Promise<string> {
  const result = await owner().query<{ id: string }>(
    `INSERT INTO invitations (company_id, email, invited_by, expires_at) VALUES ($1, $2, $3, now() + interval '7 days') RETURNING id`,
    [tenant.company.id, email, tenant.hr.id]
  )
  return result.rows[0].id
}

const tokenIn = (text: string, parameter: string) => decodeURIComponent(new RegExp(`${parameter}=([^\\s]+)`).exec(text)![1])

describe('invitation', () => {
  it('envoie le lien d’invitation ; seule l’empreinte du jeton est en base ; événement « sent »', async () => {
    const tenant = await createTenant('worker-invitation')
    const email = `recrue@${tenant.company.domain}`
    const invitationId = await invitationFor(tenant, email)
    const { type, handlers } = handlersFor(INVITATION_REQUESTED)
    const eventId = await insertEvent({ companyId: tenant.company.id, type, payload: { invitationId } })

    expect(await processNextEvent(handlers, { companyId: tenant.company.id })).toBe(true)

    const mail = await waitForEmail(email)
    expect(mail.Subject).toBe(`Invitation à rejoindre ${tenant.company.name} sur Expense.io`)
    expect(mail.Text).toContain(`${APP_URL}/signup?invitation=`)
    const stored = await owner().query<{ token_hash: string }>('SELECT token_hash FROM invitations WHERE id = $1', [invitationId])
    expect(stored.rows[0].token_hash).toBe(hashToken(tokenIn(mail.Text, 'invitation')))
    expect(await eventState(eventId)).toMatchObject({ status: 'sent', attempts: 1 })
  })

  it('invitation déjà acceptée : rien à envoyer, aucun email, événement terminé', async () => {
    const tenant = await createTenant('worker-invitation-acceptee')
    const email = `deja@${tenant.company.domain}`
    const invitationId = await invitationFor(tenant, email)
    await owner().query('UPDATE invitations SET accepted_at = now() WHERE id = $1', [invitationId])
    const { type, handlers } = handlersFor(INVITATION_REQUESTED)
    const eventId = await insertEvent({ companyId: tenant.company.id, type, payload: { invitationId } })
    await processNextEvent(handlers, { companyId: tenant.company.id })
    expect(await eventState(eventId)).toMatchObject({ status: 'sent' })
    expect(await countEmails(email)).toBe(0)
  })
})

describe('vérification d’email', () => {
  it('envoie le lien de vérification au compte non vérifié, empreinte et échéance posées', async () => {
    const tenant = await createTenant('worker-verification')
    const pending = await addMember(tenant.company, { name: 'Nouvelle Rh', role: 'hr_admin', verified: false })
    const { type, handlers } = handlersFor(EMAIL_VERIFICATION_REQUESTED)
    await insertEvent({ companyId: tenant.company.id, type, payload: { userId: pending.id } })

    await processNextEvent(handlers, { companyId: tenant.company.id })

    const mail = await waitForEmail(pending.email)
    expect(mail.Text).toContain('Bonjour Nouvelle Rh,')
    const stored = await owner().query<{ verification_token_hash: string; verification_expires_at: Date }>(
      'SELECT verification_token_hash, verification_expires_at FROM users WHERE id = $1',
      [pending.id]
    )
    expect(stored.rows[0].verification_token_hash).toBe(hashToken(tokenIn(mail.Text, 'token')))
    expect(stored.rows[0].verification_expires_at.getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000)
  })

  it('envoi en panne : relance programmée, et l’empreinte du jeton annulée avec le point de sauvegarde', async () => {
    const tenant = await createTenant('worker-verification-panne')
    const pending = await addMember(tenant.company, { name: 'Malchanceux', role: 'hr_admin', verified: false })
    const failing: EmailPort = { send: async () => { throw new Error('SMTP indisponible') } }
    const { type, handlers } = handlersFor(EMAIL_VERIFICATION_REQUESTED, failing)
    const eventId = await insertEvent({ companyId: tenant.company.id, type, payload: { userId: pending.id } })

    await processNextEvent(handlers, { companyId: tenant.company.id })

    expect(await eventState(eventId)).toMatchObject({ status: 'pending', attempts: 1, lastError: 'SMTP indisponible' })
    const stored = await owner().query('SELECT verification_token_hash FROM users WHERE id = $1', [pending.id])
    expect(stored.rows[0].verification_token_hash).toBeNull()
  })
})
