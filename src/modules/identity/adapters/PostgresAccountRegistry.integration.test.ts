import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { PgIdentityEmailTokens } from './PgIdentityEmailTokens'
import { PostgresAccountRegistry } from './PostgresAccountRegistry'
import { PostgresInvitationRepository } from './PostgresInvitationRepository'
import { EMAIL_VERIFICATION_REQUESTED } from '@/modules/identity/domain/identity'
import { withUserScope } from '@/lib/db'
import { hashToken } from '@/lib/tokens'
import { eventsOfCompany } from '../../../../integration/support/outbox'
import { addMember, createTenant, owner, TENANT_DOMAIN_SUFFIX } from '../../../../integration/support/tenant'
import { asWorker } from '../../../../integration/support/worker'

// Inscription et invitation avant toute session, sous `expense_app` : chaque
// appel passe par une fonction SECURITY DEFINER (S7, ADR-001 §3, 2-496). Les
// jetons ne sont stockés qu'en empreinte ; le worker la pose à l'envoi, ici
// par `PgIdentityEmailTokens` sous `expense_worker`.

const registry = new PostgresAccountRegistry()
const HASH = '$2b$04$abcdefghijklmnopqrstuuJ0oT0b3s2ZbXx7q7Yg5m1kz1H2O3a4.' // jamais vérifié ici

const uniqueDomain = () => `inscription-${randomUUID().slice(0, 8)}${TENANT_DOMAIN_SUFFIX}`

async function userByEmail(email: string) {
  const result = await owner().query<{ id: string; company_id: string; role: string; email_verified_at: Date | null; manager_id: string | null }>(
    'SELECT id, company_id, role, email_verified_at, manager_id FROM users WHERE email = $1',
    [email]
  )
  return result.rows[0]
}

/** Invitation créée par la RH, puis jeton posé par le worker : rend le jeton en clair, comme dans l'email. */
async function invite(hrId: string, email: string, expiresAt = new Date(Date.now() + 3600_000)) {
  const { id } = await new PostgresInvitationRepository().invite(hrId, email, expiresAt)
  const token = randomUUID()
  await asWorker((client) => new PgIdentityEmailTokens(client).issueInvitationToken(id, hashToken(token)))
  return { id, token }
}

describe('registerCompanyAdmin', () => {
  it('crée l’entreprise et sa RH, non vérifiée, et demande l’email de vérification', async () => {
    const domain = uniqueDomain()
    const email = `fondatrice@${domain}`
    const userId = await registry.registerCompanyAdmin({ name: 'Fanny Fondatrice', email, passwordHash: HASH, companyName: 'Acme', domain })
    const user = await userByEmail(email)
    expect(user).toMatchObject({ id: userId, role: 'hr_admin', email_verified_at: null })
    expect((await eventsOfCompany(user.company_id)).map((event) => [event.type, event.payload])).toEqual([
      [EMAIL_VERIFICATION_REQUESTED, { userId }],
    ])
  })

  it('une nouvelle inscription sur une adresse non vérifiée la remplace, entreprise fantôme supprimée', async () => {
    const email = `doublon@${uniqueDomain()}`
    const first = await registry.registerCompanyAdmin({ name: 'Premier', email, passwordHash: HASH, companyName: 'A', domain: uniqueDomain() })
    const firstCompany = (await userByEmail(email)).company_id
    const second = await registry.registerCompanyAdmin({ name: 'Second', email, passwordHash: HASH, companyName: 'B', domain: uniqueDomain() })
    expect(second).not.toBe(first)
    expect((await owner().query('SELECT 1 FROM companies WHERE id = $1', [firstCompany])).rowCount).toBe(0)
  })

  it('une adresse vérifiée est prise : null, rien n’est créé', async () => {
    const { employee } = await createTenant('inscription-prise')
    const domain = uniqueDomain()
    expect(
      await registry.registerCompanyAdmin({ name: 'Intrus', email: employee.email, passwordHash: HASH, companyName: 'X', domain })
    ).toBeNull()
    expect((await owner().query('SELECT 1 FROM companies WHERE email_domain = $1', [domain])).rowCount).toBe(0)
  })
})

describe('vérification d’email', () => {
  it('verifiedAccountExists : faux pour un compte non vérifié, vrai après le lien, lien à usage unique', async () => {
    const tenant = await createTenant('verification')
    const pending = await addMember(tenant.company, { name: 'Nouveau', role: 'hr_admin', verified: false })
    expect(await registry.verifiedAccountExists(pending.email)).toBe(false)

    const token = randomUUID()
    const issued = await asWorker((client) => new PgIdentityEmailTokens(client).issueVerificationToken(pending.id, hashToken(token), 24))
    expect(issued).toEqual({ email: pending.email, name: 'Nouveau' })

    expect(await registry.verifyEmail(hashToken(token))).toBe(true)
    expect(await registry.verifiedAccountExists(pending.email)).toBe(true)
    expect(await registry.verifyEmail(hashToken(token))).toBe(false)
  })

  it('un jeton expiré ou inconnu ne vérifie rien', async () => {
    const tenant = await createTenant('verification-expiree')
    const pending = await addMember(tenant.company, { name: 'Lent', role: 'hr_admin', verified: false })
    const token = randomUUID()
    await asWorker((client) => new PgIdentityEmailTokens(client).issueVerificationToken(pending.id, hashToken(token), 24))
    await owner().query("UPDATE users SET verification_expires_at = now() - interval '1 second' WHERE id = $1", [pending.id])
    expect(await registry.verifyEmail(hashToken(token))).toBe(false)
    expect(await registry.verifyEmail(hashToken(randomUUID()))).toBe(false)
  })

  it('compte déjà vérifié : le worker n’émet aucun jeton', async () => {
    const { hr } = await createTenant('verification-deja')
    expect(await asWorker((client) => new PgIdentityEmailTokens(client).issueVerificationToken(hr.id, hashToken(randomUUID()), 24))).toBeNull()
  })

  it('requestVerification : un événement pour le compte non vérifié, aucun pour une adresse vérifiée ou inconnue', async () => {
    const tenant = await createTenant('verification-renvoi')
    const pending = await addMember(tenant.company, { name: 'Oublieux', role: 'hr_admin', verified: false })
    await registry.requestVerification(pending.email)
    await registry.requestVerification(tenant.hr.email)
    await registry.requestVerification(`inconnu@${tenant.company.domain}`)
    expect((await eventsOfCompany(tenant.company.id)).map((event) => event.payload)).toEqual([{ userId: pending.id }])
  })

  it('tant qu’une demande attend, un nouveau renvoi n’en ajoute pas', async () => {
    const tenant = await createTenant('verification-renvoi-double')
    const pending = await addMember(tenant.company, { name: 'Insistant', role: 'hr_admin', verified: false })
    // Une seule transaction : aucun worker lancé sur la même base ne peut
    // consommer la première demande entre les deux appels.
    await withUserScope(tenant.hr.id, async (client) => {
      await client.query('SELECT request_email_verification($1)', [pending.email])
      await client.query('SELECT request_email_verification($1)', [pending.email])
    })
    expect(await eventsOfCompany(tenant.company.id)).toHaveLength(1)
  })
})

describe('invitation', () => {
  it('previewInvitation rend l’adresse et l’entreprise d’un jeton valable', async () => {
    const { company, hr } = await createTenant('apercu')
    const email = `invite@${company.domain}`
    const { token } = await invite(hr.id, email)
    expect(await registry.previewInvitation(hashToken(token))).toEqual({ email, companyName: company.name })
    expect(await registry.previewInvitation(hashToken(randomUUID()))).toBeNull()
  })

  it('acceptInvitation crée un employé vérifié, sans manager, dans l’entreprise de la RH ; le lien ne sert qu’une fois', async () => {
    const { company, hr } = await createTenant('acceptation')
    const email = `recrue@${company.domain}`
    const { token } = await invite(hr.id, email)
    const result = await registry.acceptInvitation({ name: 'Rita Recrue', email, passwordHash: HASH, tokenHash: hashToken(token) })
    expect(result).toEqual({ userId: expect.any(String) })
    expect(await userByEmail(email)).toMatchObject({ company_id: company.id, role: 'employee', manager_id: null })
    expect((await userByEmail(email)).email_verified_at).toBeInstanceOf(Date)
    expect(await registry.acceptInvitation({ name: 'Rita', email, passwordHash: HASH, tokenHash: hashToken(token) })).toEqual({
      failure: 'invalid',
    })
  })

  it('jeton présenté avec une autre adresse, ou invitation expirée : invalid, aucun compte', async () => {
    const { company, hr } = await createTenant('acceptation-refus')
    const email = `cible@${company.domain}`
    const { token } = await invite(hr.id, email)
    expect(
      await registry.acceptInvitation({ name: 'Usurpateur', email: `autre@${company.domain}`, passwordHash: HASH, tokenHash: hashToken(token) })
    ).toEqual({ failure: 'invalid' })

    const late = await invite(hr.id, `tard@${company.domain}`)
    await owner().query("UPDATE invitations SET expires_at = now() - interval '1 second' WHERE id = $1", [late.id])
    expect(
      await registry.acceptInvitation({ name: 'Tard', email: `tard@${company.domain}`, passwordHash: HASH, tokenHash: hashToken(late.token) })
    ).toEqual({ failure: 'invalid' })
    expect(await userByEmail(`autre@${company.domain}`)).toBeUndefined()
    expect(await userByEmail(`tard@${company.domain}`)).toBeUndefined()
  })

  it('adresse déjà vérifiée ailleurs : email_taken ; inscription non vérifiée : remplacée par l’invité', async () => {
    const { company, hr } = await createTenant('acceptation-adresse')
    const other = await createTenant('acceptation-adresse-b')
    const taken = await invite(hr.id, other.employee.email)
    expect(
      await registry.acceptInvitation({ name: 'X', email: other.employee.email, passwordHash: HASH, tokenHash: hashToken(taken.token) })
    ).toEqual({ failure: 'email_taken' })

    const ghostEmail = `fantome@${uniqueDomain()}`
    await registry.registerCompanyAdmin({ name: 'Fantome', email: ghostEmail, passwordHash: HASH, companyName: 'F', domain: uniqueDomain() })
    const ghostCompany = (await userByEmail(ghostEmail)).company_id
    const replaced = await invite(hr.id, ghostEmail)
    expect(
      await registry.acceptInvitation({ name: 'Invite', email: ghostEmail, passwordHash: HASH, tokenHash: hashToken(replaced.token) })
    ).toEqual({ userId: expect.any(String) })
    expect(await userByEmail(ghostEmail)).toMatchObject({ company_id: company.id, role: 'employee' })
    expect((await owner().query('SELECT 1 FROM companies WHERE id = $1', [ghostCompany])).rowCount).toBe(0)
  })
})
