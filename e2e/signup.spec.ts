import { randomUUID } from 'node:crypto'
import type { Page } from '@playwright/test'
import { uniqueDomain } from './support/db'
import { AUTH_TIMEOUT, expect, test } from './support/fixtures'
import { signUpAndVerify } from './support/identity'

const INVALID_SIGNUP_MESSAGE =
  'Nom requis, email invalide, ou mot de passe trop court (8 caractères minimum).'

async function fillSignupForm(
  page: Page,
  fields: { name: string; email: string; password: string }
): Promise<void> {
  await page.goto('/signup')
  await expect(page.getByRole('heading', { name: 'Créer un compte' })).toBeVisible()
  await page.getByLabel('Nom').fill(fields.name)
  await page.getByLabel('Email').fill(fields.email)
  await page.getByLabel('Mot de passe').fill(fields.password)
}

async function signUp(
  page: Page,
  fields: { name: string; email: string; password: string }
): Promise<void> {
  await fillSignupForm(page, fields)
  await page.getByRole('button', { name: "S'inscrire" }).click()
}

test.describe('Inscription', () => {
  test('[SIGNUP-01] premier compte sans invitation → crée l’entreprise et devient RH, connecté après confirmation de l’email', async ({
    page,
  }) => {
    // S7 (ADR-001 §3) : connexion seulement après le lien de confirmation.
    const email = `alice@${uniqueDomain('signup-01')}`
    await signUpAndVerify(page, { name: 'Alice Fondatrice', email, password: 'motdepasse-solide' })

    await expect(page).toHaveURL(/\/expenses$/, { timeout: AUTH_TIMEOUT })
    const banner = page.getByRole('banner')
    await expect(banner).toContainText(email)
    await expect(banner.getByRole('link', { name: 'RH', exact: true })).toBeVisible()
    await expect(banner.getByRole('link', { name: 'Manager', exact: true })).toHaveCount(0)

    // Nouvelle entreprise : la RH y est seule, l'organigramme est vide.
    await banner.getByRole('link', { name: 'RH', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Espace RH' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Organigramme (0)' })).toBeVisible()
    await expect(page.getByText('Aucun employé ou manager dans cette entreprise.')).toBeVisible()
  })

  test('[SIGNUP-02] compte suivant sur le même domaine, sans invitation → RH de sa propre entreprise, invisible de la première', async ({
    page,
    openPage,
  }) => {
    // S7 (ADR-001 §3) : le domaine ne regroupe plus personne ; rejoindre une
    // entreprise passe par une invitation (SIGNUP-08b).
    const domain = uniqueDomain('signup-02')
    const hrPage = await openPage()
    await signUpAndVerify(hrPage, { name: 'Alice Fondatrice', email: `alice@${domain}`, password: 'motdepasse-1' })

    const secondEmail = `bob@${domain}`
    await signUpAndVerify(page, { name: 'Bob Arrivant', email: secondEmail, password: 'motdepasse-2' })
    const banner = page.getByRole('banner')
    await expect(banner).toContainText(secondEmail)
    await expect(banner.getByRole('link', { name: 'RH', exact: true })).toBeVisible()
    await page.goto('/hr')
    await expect(page.getByRole('heading', { name: 'Organigramme (0)' })).toBeVisible()

    // La première RH ne voit pas ce compte.
    await hrPage.goto('/hr')
    await expect(hrPage.getByRole('heading', { name: 'Organigramme (0)' })).toBeVisible()
    await expect(hrPage.getByRole('row', { name: /Bob Arrivant/ })).toHaveCount(0)
  })

  test('[SIGNUP-03] email déjà utilisé → « Un compte existe déjà avec cet email. »', async ({
    page,
    org,
  }) => {
    await signUp(page, { name: 'Doublon', email: org.employee.email, password: 'motdepasse-solide' })

    await expect(page.getByRole('main').getByRole('alert')).toHaveText(
      'Un compte existe déjà avec cet email.',
      { timeout: AUTH_TIMEOUT }
    )
    await expect(page).toHaveURL(/\/signup$/)
  })

  test('[SIGNUP-04] nom composé uniquement d’espaces → refus serveur avec le message de validation', async ({
    page,
  }) => {
    await signUp(page, {
      name: '   ',
      email: `espaces@${uniqueDomain('signup-04')}`,
      password: 'motdepasse-solide',
    })

    await expect(page.getByRole('main').getByRole('alert')).toHaveText(INVALID_SIGNUP_MESSAGE, {
      timeout: AUTH_TIMEOUT,
    })
    await expect(page).toHaveURL(/\/signup$/)
  })

  test('[SIGNUP-05] email sans point dans le domaine → refus serveur avec le message de validation', async ({
    page,
  }) => {
    // Accepté par la validation HTML (type=email) mais pas par le serveur.
    await signUp(page, {
      name: 'Sans Point',
      email: `sanspoint-${randomUUID().slice(0, 8)}@localhost`,
      password: 'motdepasse-solide',
    })

    await expect(page.getByRole('main').getByRole('alert')).toHaveText(INVALID_SIGNUP_MESSAGE, {
      timeout: AUTH_TIMEOUT,
    })
    await expect(page).toHaveURL(/\/signup$/)
  })

  test('[SIGNUP-06] mot de passe < 8 caractères → bloqué par le navigateur, et refusé par le serveur', async ({
    page,
  }) => {
    const fields = {
      name: 'Mot Court',
      email: `court@${uniqueDomain('signup-06')}`,
      password: 'court',
    }
    await fillSignupForm(page, fields)
    const passwordInput = page.getByLabel('Mot de passe')
    await expect(passwordInput).toHaveAttribute('minlength', '8')
    await page.getByRole('button', { name: "S'inscrire" }).click()
    expect(await passwordInput.evaluate((input: HTMLInputElement) => input.validity.tooShort)).toBe(
      true
    )
    await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0)

    // Validation HTML désactivée : le serveur applique la même règle.
    await page.locator('form').evaluate((form: HTMLFormElement) => {
      form.noValidate = true
    })
    await page.getByRole('button', { name: "S'inscrire" }).click()
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(INVALID_SIGNUP_MESSAGE, {
      timeout: AUTH_TIMEOUT,
    })
    await expect(page).toHaveURL(/\/signup$/)
  })

  test('[SIGNUP-07] le compte créé permet ensuite de se connecter via /login', async ({ page }) => {
    const email = `carole@${uniqueDomain('signup-07')}`
    // S7 (ADR-001 §3) : email confirmé avant la première connexion.
    await signUpAndVerify(page, { name: 'Carole Retour', email, password: 'motdepasse-solide' })
    await expect(page).toHaveURL(/\/expenses$/, { timeout: AUTH_TIMEOUT })
    await page.getByRole('banner').getByRole('button', { name: 'Se déconnecter' }).click()
    await expect(page).toHaveURL(/\/login$/)

    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Mot de passe').fill('motdepasse-solide')
    await page.getByRole('button', { name: 'Se connecter' }).click()
    await expect(page).toHaveURL(/\/expenses$/, { timeout: AUTH_TIMEOUT })
    await expect(page.getByRole('banner')).toContainText(email)
  })
})
