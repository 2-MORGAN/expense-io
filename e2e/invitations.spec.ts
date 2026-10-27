import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { setUserContext } from '@/lib/db'
import { db, findUserByEmail, uniqueDomain } from './support/db'
import { AUTH_TIMEOUT, createOrg, expect, test } from './support/fixtures'
import {
  inviteFromHrPage,
  linkFromEmail,
  logIn,
  pathOf,
  signUpAndVerify,
  submitSignup,
} from './support/identity'

// S7 (ADR-001 §3, 2-496) : le domaine de l'email ne donne plus aucun droit.
// Sans invitation, on crée sa propre entreprise (email à confirmer) ; on ne
// rejoint une entreprise que par une invitation de sa RH.

const PASSWORD = 'motdepasse-invitation'
const INVALID_INVITATION = 'Invitation invalide ou expirée.'

function invitedAddress(label: string): string {
  return `${label}.${randomUUID().slice(0, 8)}@invite.e2e.test`
}

test.describe('Inscription sans invitation (S7)', () => {
  test('[SIGNUP-08a] deux inscriptions sur le même domaine → deux entreprises distinctes, chacune avec sa RH', async ({
    page,
    openPage,
  }) => {
    const domain = uniqueDomain('signup-08a')
    const first = { name: 'Alice Premiere', email: `alice@${domain}`, password: PASSWORD }
    const second = { name: 'Bob Second', email: `bob@${domain}`, password: PASSWORD }

    await signUpAndVerify(page, first)
    const otherPage = await openPage()
    await signUpAndVerify(otherPage, second)

    const alice = await findUserByEmail(first.email)
    const bob = await findUserByEmail(second.email)
    expect(alice?.role).toBe('hr_admin')
    expect(bob?.role).toBe('hr_admin')
    expect(bob?.companyId).not.toBe(alice?.companyId)

    // Aucune ne voit l'autre.
    await page.goto('/hr')
    await expect(page.getByRole('heading', { name: 'Organigramme (0)' })).toBeVisible()
    await otherPage.goto('/hr')
    await expect(otherPage.getByRole('heading', { name: 'Organigramme (0)' })).toBeVisible()
  })

  test('[SIGNUP-10] créateur non vérifié → connexion refusée avec un message dédié, puis acceptée après le lien', async ({
    page,
  }) => {
    const fields = { name: 'Carla Attente', email: `carla@${uniqueDomain('signup-10')}`, password: PASSWORD }
    await submitSignup(page, fields)
    await expect(page).toHaveURL(/\/signup\/verify$/, { timeout: AUTH_TIMEOUT })
    await expect(page.getByRole('heading', { name: 'Vérifiez votre boîte mail' })).toBeVisible()

    await logIn(page, fields.email, fields.password)
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(
      'Confirmez votre adresse email avant de vous connecter.',
      { timeout: AUTH_TIMEOUT }
    )
    await expect(page).toHaveURL(/\/login$/)

    // Un mauvais mot de passe garde le message générique : rien n'est révélé.
    await logIn(page, fields.email, 'mauvais-mot-de-passe')
    await expect(page.getByRole('main').getByRole('alert')).toHaveText('Email ou mot de passe incorrect.', {
      timeout: AUTH_TIMEOUT,
    })

    const link = await linkFromEmail(page.context().request, fields.email, '/verify-email')
    await page.goto(pathOf(link))
    await expect(page.getByRole('status')).toHaveText('Email confirmé, vous pouvez vous connecter.')
    await logIn(page, fields.email, fields.password)
    await expect(page).toHaveURL(/\/expenses$/, { timeout: AUTH_TIMEOUT })

    // Le lien est à usage unique.
    await page.goto(pathOf(link))
    await expect(page).toHaveURL(/\/login\?verification=invalid$/)
  })
})

test.describe('Invitation par la RH (S7)', () => {
  test('[SIGNUP-08b] invitation valide → employé de l’entreprise de la RH, connecté, visible dans l’organigramme', async ({
    org,
    pageAs,
    page,
  }) => {
    const email = invitedAddress('signup-08b')
    const hrPage = await pageAs(org.hr)
    await inviteFromHrPage(hrPage, email)

    const link = await linkFromEmail(page.context().request, email, '/signup?invitation=')
    await page.goto(pathOf(link))
    await expect(page.getByText(`Vous rejoignez ${org.company.name}.`)).toBeVisible()
    await expect(page.getByLabel('Email')).toHaveValue(email)
    await expect(page.getByLabel('Email')).toHaveAttribute('readonly', '')
    await submitSignup(page, { name: 'Ines Invitee', password: PASSWORD }, '')

    await expect(page).toHaveURL(/\/expenses$/, { timeout: AUTH_TIMEOUT })
    await expect(page.getByRole('banner')).toContainText(email)
    const joined = await findUserByEmail(email)
    expect(joined).toMatchObject({ role: 'employee', companyId: org.company.id, managerId: null })

    await hrPage.goto('/hr')
    const row = hrPage.getByRole('row', { name: /Ines Invitee/ })
    await expect(row).toContainText(email)
    await expect(row.getByRole('cell').nth(1)).toHaveText('employee')
  })

  test('[SIGNUP-08c] invitation expirée → refusée, à l’ouverture comme à la soumission', async ({
    org,
    apiAs,
    page,
    openPage,
  }) => {
    const email = invitedAddress('signup-08c')
    const hr = await apiAs(org.hr)
    const response = await hr.request.post('/api/hr/invitations', { data: { email } })
    expect(response.status()).toBe(201)
    const { id } = (await response.json()) as { id: string }
    const link = await linkFromEmail(page.context().request, email, '/signup?invitation=')

    // Formulaire ouvert pendant la validité, invitation expirée avant l'envoi.
    await page.goto(pathOf(link))
    await expect(page.getByLabel('Email')).toHaveValue(email)
    await db().query("UPDATE invitations SET expires_at = now() - interval '1 minute' WHERE id = $1", [id])
    await submitSignup(page, { name: 'Tom Tard', password: PASSWORD }, '')
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(INVALID_INVITATION, { timeout: AUTH_TIMEOUT })
    expect(await findUserByEmail(email)).toBeNull()

    const later = await openPage()
    await later.goto(pathOf(link))
    await expect(later.getByRole('main').getByRole('alert')).toContainText(INVALID_INVITATION)
    await expect(later.getByLabel('Email')).toHaveValue('')
  })

  test('[SIGNUP-08d] invitation déjà utilisée → refusée', async ({ org, apiAs, page, openPage }) => {
    const email = invitedAddress('signup-08d')
    const hr = await apiAs(org.hr)
    expect((await hr.request.post('/api/hr/invitations', { data: { email } })).status()).toBe(201)
    const link = await linkFromEmail(page.context().request, email, '/signup?invitation=')

    await page.goto(pathOf(link))
    await submitSignup(page, { name: 'Ugo Unique', password: PASSWORD }, '')
    await expect(page).toHaveURL(/\/expenses$/, { timeout: AUTH_TIMEOUT })

    const again = await openPage()
    await again.goto(pathOf(link))
    await expect(again.getByRole('main').getByRole('alert')).toContainText(INVALID_INVITATION)
  })

  test('[SIGNUP-08e] jeton d’invitation présenté avec une autre adresse → refusé, aucun compte créé', async ({
    org,
    apiAs,
    page,
  }) => {
    const email = invitedAddress('signup-08e')
    const other = invitedAddress('signup-08e-autre')
    const hr = await apiAs(org.hr)
    expect((await hr.request.post('/api/hr/invitations', { data: { email } })).status()).toBe(201)
    const link = await linkFromEmail(page.context().request, email, '/signup?invitation=')

    await page.goto(pathOf(link))
    // Champ en lecture seule contourné : le serveur compare l'adresse à celle de l'invitation.
    await page.getByLabel('Email').evaluate((input: HTMLInputElement) => {
      input.readOnly = false
    })
    await submitSignup(page, { name: 'Vic Voleur', email: other, password: PASSWORD }, '')
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(INVALID_INVITATION, { timeout: AUTH_TIMEOUT })
    expect(await findUserByEmail(other)).toBeNull()
  })
})

test.describe('API des invitations', () => {
  test('[INV-01] POST /api/hr/invitations : 401 sans session, 403 hors RH, 400 email invalide, 201 pour la RH', async ({
    org,
    apiAs,
    request,
  }) => {
    const email = invitedAddress('inv-01')
    expect((await request.post('/api/hr/invitations', { data: { email } })).status()).toBe(401)
    for (const user of [org.employee, org.manager]) {
      const api = await apiAs(user)
      expect((await api.request.post('/api/hr/invitations', { data: { email } })).status()).toBe(403)
    }

    const hr = await apiAs(org.hr)
    const invalid = await hr.request.post('/api/hr/invitations', { data: { email: 'pas-une-adresse' } })
    expect(invalid.status()).toBe(400)
    expect(await invalid.json()).toMatchObject({ code: 'INVALID_EMAIL' })

    const created = await hr.request.post('/api/hr/invitations', { data: { email: ` ${email.toUpperCase()} ` } })
    expect(created.status()).toBe(201)
    const invitation = (await created.json()) as { id: string }
    expect(invitation).toEqual({ id: expect.any(String), email, expiresAt: expect.any(String) })

    // Relance de la même adresse : même invitation, nouveau lien, l'ancien ne vaut plus rien.
    const firstLink = await linkFromEmail(request, email, '/signup?invitation=')
    const resent = await hr.request.post('/api/hr/invitations', { data: { email } })
    expect(((await resent.json()) as { id: string }).id).toBe(invitation.id)
    const sentEmails = async () =>
      (
        await db().query<{ n: number }>(
          `SELECT count(*)::int AS n FROM outbox_events
           WHERE type = 'invitation.requested' AND payload->>'invitationId' = $1 AND status = 'sent'`,
          [invitation.id]
        )
      ).rows[0].n
    await expect.poll(sentEmails, { timeout: 20_000 }).toBe(2)
    const preview = await request.get(pathOf(firstLink))
    expect(await preview.text()).toContain(INVALID_INVITATION)
  })

  test('[INV-02] une invitation reste dans son entreprise (RLS, rôle expense_app)', async ({ org, apiAs }) => {
    const other = await createOrg('inv-02-b')
    const email = invitedAddress('inv-02')
    const hr = await apiAs(org.hr)
    const { id } = (await (await hr.request.post('/api/hr/invitations', { data: { email } })).json()) as { id: string }

    async function asApp<T>(userId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
      const client = await db().connect()
      try {
        await client.query('BEGIN')
        await client.query('SET LOCAL ROLE expense_app')
        await setUserContext(client, userId)
        return await fn(client)
      } finally {
        await client.query('ROLLBACK')
        client.release()
      }
    }
    const visible = (userId: string) =>
      asApp(userId, async (client) => (await client.query('SELECT id FROM invitations WHERE id = $1', [id])).rowCount)

    expect(await visible(org.hr.id)).toBe(1)
    expect(await visible(other.hr.id)).toBe(0)
    expect(await visible(org.employee.id)).toBe(0)
    expect(await visible(org.manager.id)).toBe(0)

    // Ni la RH d'une autre entreprise ni un employé ne peuvent en créer une pour l'entreprise A.
    await asApp(other.hr.id, async (client) => {
      await expect(
        client.query(
          `INSERT INTO invitations (company_id, email, invited_by, expires_at) VALUES ($1, $2, $3, now() + interval '1 day')`,
          [org.company.id, invitedAddress('inv-02-intrus'), other.hr.id]
        )
      ).rejects.toMatchObject({ code: '42501' })
    })
    await asApp(org.employee.id, async (client) => {
      await expect(
        client.query(
          `INSERT INTO invitations (company_id, email, invited_by, expires_at) VALUES ($1, $2, $3, now() + interval '1 day')`,
          [org.company.id, invitedAddress('inv-02-employe'), org.employee.id]
        )
      ).rejects.toMatchObject({ code: '42501' })
    })
  })

  test('[INV-03] POST /api/hr/invitations : erreurs d’entrée uniformes et adresse conforme au contrat', async ({ org, apiAs }) => {
    const hr = await apiAs(org.hr)
    const invitations = async () =>
      (await db().query<{ n: number }>('SELECT count(*)::int AS n FROM invitations WHERE company_id = $1', [org.company.id])).rows[0].n
    const post = (data: unknown) => hr.request.post('/api/hr/invitations', { data })

    // JSON malformé : même code que les autres opérations JSON (ADR-004 §6).
    const malformed = await hr.request.post('/api/hr/invitations', {
      headers: { 'Content-Type': 'application/json' },
      data: '{"email": ',
    })
    expect(malformed.status()).toBe(400)
    expect(await malformed.json()).toMatchObject({ code: 'INVALID_JSON' })

    // Corps hors contrat : champ absent, mauvais type, corps qui n’est pas un objet.
    for (const body of [{}, { email: 42 }, ['salarie@example.org']]) {
      const response = await post(body)
      expect(response.status(), JSON.stringify(body)).toBe(400)
      expect(await response.json(), JSON.stringify(body)).toMatchObject({ code: 'VALIDATION_ERROR' })
    }

    // Adresses que le contrat refuserait en réponse 201 (format email) : refusées dès l’entrée.
    for (const email of ['a..b@invite.e2e.test', '.a@invite.e2e.test', 'a(b)@invite.e2e.test', 'é@invite.e2e.test', 'a@-invite.e2e.test']) {
      const response = await post({ email })
      expect(response.status(), email).toBe(400)
      expect(await response.json(), email).toMatchObject({ code: 'INVALID_EMAIL' })
    }
    expect(await invitations()).toBe(0)
  })
})
