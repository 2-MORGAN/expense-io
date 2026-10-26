import { randomUUID } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'
import type { APIRequestContext } from '@playwright/test'
import { db, findUserByEmail, uniqueDomain } from './support/db'
import { AUTH_TIMEOUT, expect, test } from './support/fixtures'
import { countEmails } from './support/mailpit'
import { inviteFromHrPage, linkFromEmail, logIn, pathOf, signUpAndVerify, submitSignup } from './support/identity'

// S7 (ADR-001 §3, 2-496) : un compte non vérifié ne bloque pas son adresse.
// Seule une adresse prouvée (lien de vérification ou d'invitation) la garde ;
// une inscription non confirmée peut être remplacée, et l'email de
// vérification peut être renvoyé.

const PASSWORD = 'motdepasse-non-verifie'
const RESEND_NOTICE = 'Si un compte non confirmé existe pour cette adresse, un nouvel email de confirmation a été envoyé.'

function invitedAddress(label: string): string {
  return `${label}.${randomUUID().slice(0, 8)}@invite.e2e.test`
}

async function waitForEmailCount(request: APIRequestContext, to: string, count: number): Promise<void> {
  const deadline = Date.now() + 20_000
  while ((await countEmails(request, to)) < count) {
    if (Date.now() > deadline) throw new Error(`Moins de ${count} email(s) pour ${to} dans Mailpit`)
    await sleep(250)
  }
}

async function companyExists(companyId: string): Promise<boolean> {
  const result = await db().query('SELECT 1 FROM companies WHERE id = $1', [companyId])
  return (result.rowCount ?? 0) > 0
}

test.describe('Adresse non vérifiée (S7)', () => {
  test('[SIGNUP-11a] inscription non confirmée sur une adresse, puis invitation de la RH → l’invité rejoint l’entreprise, l’entreprise fantôme disparaît', async ({
    org,
    pageAs,
    page,
    openPage,
  }) => {
    const email = invitedAddress('signup-11a')
    // Quelqu'un s'inscrit avec l'adresse sans y avoir accès : rien n'est confirmé.
    await submitSignup(page, { name: 'Squatteur', email, password: 'autre-mot-de-passe' })
    await expect(page).toHaveURL(/\/signup\/verify$/, { timeout: AUTH_TIMEOUT })
    await waitForEmailCount(page.context().request, email, 1)
    const squatter = await findUserByEmail(email)
    expect(squatter?.role).toBe('hr_admin')

    const hrPage = await pageAs(org.hr)
    await inviteFromHrPage(hrPage, email)
    await waitForEmailCount(page.context().request, email, 2)
    const link = await linkFromEmail(page.context().request, email, '/signup?invitation=')

    const invited = await openPage()
    await invited.goto(pathOf(link))
    await submitSignup(invited, { name: 'Vraie Personne', password: PASSWORD }, '')
    await expect(invited).toHaveURL(/\/expenses$/, { timeout: AUTH_TIMEOUT })

    const joined = await findUserByEmail(email)
    expect(joined).toMatchObject({ role: 'employee', companyId: org.company.id })
    expect(await companyExists(squatter!.companyId)).toBe(false)
  })

  test('[SIGNUP-11b] adresse déjà vérifiée → l’invitation est refusée et le compte existant reste intact', async ({
    org,
    pageAs,
    page,
    openPage,
  }) => {
    const email = invitedAddress('signup-11b')
    await signUpAndVerify(page, { name: 'Deja Verifiee', email, password: PASSWORD })
    const existing = await findUserByEmail(email)

    const hrPage = await pageAs(org.hr)
    await inviteFromHrPage(hrPage, email)
    await waitForEmailCount(page.context().request, email, 2)
    const link = await linkFromEmail(page.context().request, email, '/signup?invitation=')

    const invited = await openPage()
    await invited.goto(pathOf(link))
    await submitSignup(invited, { name: 'Usurpateur', password: 'autre-mot-de-passe' }, '')
    await expect(invited.getByRole('main').getByRole('alert')).toHaveText('Un compte existe déjà avec cet email.', {
      timeout: AUTH_TIMEOUT,
    })
    expect(await findUserByEmail(email)).toEqual(existing)
  })

  test('[SIGNUP-12] nouvelle inscription sur une adresse non confirmée → remplace l’ancienne, ancien lien invalide', async ({
    page,
  }) => {
    const email = `dora@${uniqueDomain('signup-12')}`
    await submitSignup(page, { name: 'Dora Premiere', email, password: 'premier-mot-de-passe' })
    await expect(page).toHaveURL(/\/signup\/verify$/, { timeout: AUTH_TIMEOUT })
    const oldLink = await linkFromEmail(page.context().request, email, '/verify-email')
    const first = await findUserByEmail(email)

    await submitSignup(page, { name: 'Dora Seconde', email, password: PASSWORD })
    await expect(page).toHaveURL(/\/signup\/verify$/, { timeout: AUTH_TIMEOUT })
    await waitForEmailCount(page.context().request, email, 2)
    const newLink = await linkFromEmail(page.context().request, email, '/verify-email')

    const second = await findUserByEmail(email)
    expect(second?.id).not.toBe(first?.id)
    expect(await companyExists(first!.companyId)).toBe(false)

    await page.goto(pathOf(oldLink))
    await expect(page).toHaveURL(/\/login\?verification=invalid$/)
    await page.goto(pathOf(newLink))
    await expect(page).toHaveURL(/\/login\?verified=1$/)

    await logIn(page, email, 'premier-mot-de-passe')
    await expect(page.getByRole('main').getByRole('alert')).toHaveText('Email ou mot de passe incorrect.', {
      timeout: AUTH_TIMEOUT,
    })
    await logIn(page, email, PASSWORD)
    await expect(page).toHaveURL(/\/expenses$/, { timeout: AUTH_TIMEOUT })
  })

  test('[SIGNUP-13] renvoi de l’email de vérification → nouveau lien valide, ancien lien invalide, réponse identique pour une adresse inconnue', async ({
    page,
  }) => {
    const email = `eva@${uniqueDomain('signup-13')}`
    await submitSignup(page, { name: 'Eva Renvoi', email, password: PASSWORD })
    await expect(page).toHaveURL(/\/signup\/verify$/, { timeout: AUTH_TIMEOUT })
    const oldLink = await linkFromEmail(page.context().request, email, '/verify-email')

    // Depuis la connexion refusée, un lien mène au renvoi.
    await logIn(page, email, PASSWORD)
    await expect(page.getByRole('main').getByRole('alert')).toContainText(
      'Confirmez votre adresse email avant de vous connecter.',
      { timeout: AUTH_TIMEOUT }
    )
    await page.getByRole('link', { name: "Renvoyer l'email de confirmation" }).click()
    await expect(page).toHaveURL(/\/signup\/verify$/)

    await page.getByLabel('Email').fill(email)
    await page.getByRole('button', { name: "Renvoyer l'email" }).click()
    await expect(page.getByRole('status')).toHaveText(RESEND_NOTICE)
    await waitForEmailCount(page.context().request, email, 2)
    const newLink = await linkFromEmail(page.context().request, email, '/verify-email')
    expect(newLink).not.toBe(oldLink)

    await page.goto(pathOf(oldLink))
    await expect(page).toHaveURL(/\/login\?verification=invalid$/)
    await page.goto(pathOf(newLink))
    await expect(page).toHaveURL(/\/login\?verified=1$/)
    await logIn(page, email, PASSWORD)
    await expect(page).toHaveURL(/\/expenses$/, { timeout: AUTH_TIMEOUT })

    // Adresse inconnue ou déjà vérifiée : même réponse, aucun email.
    const unknown = `inconnu@${uniqueDomain('signup-13-inconnu')}`
    for (const address of [unknown, email]) {
      await page.goto('/signup/verify')
      await page.getByLabel('Email').fill(address)
      await page.getByRole('button', { name: "Renvoyer l'email" }).click()
      await expect(page.getByRole('status')).toHaveText(RESEND_NOTICE)
    }
    await sleep(2_000)
    expect(await countEmails(page.context().request, unknown)).toBe(0)
    expect(await countEmails(page.context().request, email)).toBe(2)
  })
})
