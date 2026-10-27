import type { APIRequestContext, Page } from '@playwright/test'
import { AUTH_TIMEOUT, expect } from './fixtures'
import { waitForEmail } from './mailpit'

// Parcours d'identité (S7, 2-496) : inscription, liens reçus par email
// (Mailpit), connexion. Le worker lancé par `npm run dev` envoie les emails.

export interface SignupFields {
  name: string
  email: string
  password: string
}

/** Remplit et soumet `/signup` (ou le formulaire déjà ouvert d'une invitation, si `email` est absent). */
export async function submitSignup(page: Page, fields: Partial<SignupFields>, url = '/signup'): Promise<void> {
  if (url) await page.goto(url)
  await expect(page.getByRole('heading', { name: 'Créer un compte' })).toBeVisible()
  if (fields.name !== undefined) await page.getByLabel('Nom').fill(fields.name)
  if (fields.email !== undefined) await page.getByLabel('Email').fill(fields.email)
  if (fields.password !== undefined) await page.getByLabel('Mot de passe').fill(fields.password)
  await page.getByRole('button', { name: "S'inscrire" }).click()
}

/** Lien de l'email reçu par `to` dont le chemin commence par `path`. */
export async function linkFromEmail(request: APIRequestContext, to: string, path: string): Promise<string> {
  const message = await waitForEmail(request, to, 20_000)
  const escaped = path.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
  const match = new RegExp(`https?://\\S+${escaped}\\S*`).exec(message.Text)
  if (!match) throw new Error(`Aucun lien ${path} dans l’email adressé à ${to}`)
  return match[0]
}

/** Chemin relatif d'un lien absolu reçu par email (le serveur de test peut avoir une autre origine). */
export function pathOf(link: string): string {
  const url = new URL(link)
  return `${url.pathname}${url.search}`
}

export async function logIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Mot de passe').fill(password)
  await page.getByRole('button', { name: 'Se connecter' }).click()
}

/**
 * Inscription sans invitation complète : formulaire, page « Vérifiez votre
 * boîte mail », lien de confirmation, puis connexion.
 */
export async function signUpAndVerify(page: Page, fields: SignupFields): Promise<void> {
  await submitSignup(page, fields)
  await expect(page).toHaveURL(/\/signup\/verify$/, { timeout: AUTH_TIMEOUT })
  const link = await linkFromEmail(page.context().request, fields.email, '/verify-email')
  await page.goto(pathOf(link))
  await expect(page).toHaveURL(/\/login\?verified=1$/)
  await logIn(page, fields.email, fields.password)
  await expect(page).toHaveURL(/\/expenses$/, { timeout: AUTH_TIMEOUT })
}

/** Invitation envoyée depuis l'espace RH par `hrPage`, connectée. */
export async function inviteFromHrPage(hrPage: Page, email: string): Promise<void> {
  await hrPage.goto('/hr')
  await hrPage.getByLabel('Email du salarié').fill(email)
  await hrPage.getByRole('button', { name: "Envoyer l'invitation" }).click()
  await expect(hrPage.getByRole('status')).toHaveText(`Invitation envoyée à ${email}.`)
}
