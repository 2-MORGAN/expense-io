import type { Page } from '@playwright/test'
import { downloadReceipt } from './support/api'
import { findUserByEmail, setRole, uniqueDomain } from './support/db'
import { AUTH_TIMEOUT, expect, test } from './support/fixtures'
import { pngReceipt } from './support/files'
import { inviteFromHrPage, linkFromEmail, pathOf, signUpAndVerify } from './support/identity'

// Parcours métier de bout en bout, uniquement par l'interface (hors promotion
// au rôle manager, qui n'existe qu'en base/seed).

const PASSWORD = 'motdepasse-parcours'

/** Inscription par le lien d'invitation reçu par email (S7, ADR-001 §3). */
async function acceptInvitation(page: Page, name: string, email: string): Promise<void> {
  const link = await linkFromEmail(page.context().request, email, '/signup?invitation=')
  await page.goto(pathOf(link))
  await page.getByLabel('Nom').fill(name)
  await page.getByLabel('Mot de passe').fill(PASSWORD)
  await page.getByRole('button', { name: "S'inscrire" }).click()
  await expect(page).toHaveURL(/\/expenses$/, { timeout: AUTH_TIMEOUT })
}

async function logIn(page: Page, email: string): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Mot de passe').fill(PASSWORD)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page).toHaveURL(/\/expenses$/, { timeout: AUTH_TIMEOUT })
}

async function submitExpense(page: Page, description: string, amount: string): Promise<void> {
  await page.goto('/expenses')
  await page.getByLabel('Montant (€)').fill(amount)
  await page.getByLabel('Date').fill('2026-10-05')
  await page.getByLabel('Description').fill(description)
  await page.getByLabel('Reçu (image ou PDF)').setInputFiles(pngReceipt(description))
  await page.getByRole('button', { name: 'Soumettre' }).click()
  await expect(page.getByRole('row', { name: new RegExp(description) })).toContainText('en attente')
}

async function runJourney(newPage: () => Promise<Page>): Promise<void> {
  const domain = uniqueDomain('parcours')
  const hrEmail = `alice@${domain}`
  const managerEmail = `marc@${domain}`
  const employeeEmail = `eva@${domain}`

  // 1. Inscriptions : la RH crée l'entreprise et confirme son email, puis
  //    invite le futur manager et l'employée, qui la rejoignent par le lien
  //    reçu (S7, ADR-001 §3 : le domaine ne regroupe plus personne).
  const hrPage = await newPage()
  await signUpAndVerify(hrPage, { name: 'Alice Rh', email: hrEmail, password: PASSWORD })
  await inviteFromHrPage(hrPage, managerEmail)
  await inviteFromHrPage(hrPage, employeeEmail)
  const managerPage = await newPage()
  await acceptInvitation(managerPage, 'Marc Manager', managerEmail)
  const employeePage = await newPage()
  await acceptInvitation(employeePage, 'Eva Employee', employeeEmail)

  // 2. Promotion manager (seed/base uniquement), puis reconnexion pour que la
  //    session porte le nouveau rôle.
  const managerRow = await findUserByEmail(managerEmail)
  expect(managerRow?.role).toBe('employee')
  const managerId = managerRow?.id ?? ''
  await setRole(managerId, 'manager')
  await managerPage.getByRole('banner').getByRole('button', { name: 'Se déconnecter' }).click()
  await expect(managerPage).toHaveURL(/\/login$/)
  await logIn(managerPage, managerEmail)
  await expect(managerPage.getByRole('banner').getByRole('link', { name: 'Manager' })).toBeVisible()

  // 3. La RH rattache l'employée au manager.
  await hrPage.goto('/hr')
  await expect(hrPage.getByRole('heading', { name: 'Organigramme (2)' })).toBeVisible()
  const saved = hrPage.waitForResponse(
    (response) => response.request().method() === 'PUT' && response.url().includes('/api/hr/users/')
  )
  await hrPage
    .getByRole('row', { name: /Eva Employee/ })
    .getByRole('combobox')
    .selectOption({ label: 'Marc Manager' })
  expect((await saved).status()).toBe(200)
  await hrPage.reload()
  await expect(hrPage.getByRole('row', { name: /Eva Employee/ }).getByRole('combobox')).toHaveValue(
    managerId
  )

  // 4. L'employée soumet une note ; son manager consulte le reçu et approuve.
  await submitExpense(employeePage, 'Train client Lille', '64.2')
  await managerPage.goto('/manager')
  const pendingRow = managerPage.getByRole('row', { name: /Train client Lille/ })
  await expect(pendingRow).toContainText('64,20 €')
  const popupPromise = managerPage.waitForEvent('popup')
  await pendingRow.getByRole('button', { name: 'Voir le reçu' }).click()
  const popup = await popupPromise
  await popup.waitForLoadState()
  const receipt = await downloadReceipt(managerPage.request, popup.url())
  expect(receipt.status).toBe(200)
  expect(receipt.body.equals(pngReceipt('Train client Lille').buffer)).toBe(true)
  await popup.close()
  await pendingRow.getByRole('button', { name: 'Approuver' }).click()
  await expect(managerPage.getByText('Aucune note en attente.')).toBeVisible()
  await employeePage.reload()
  await expect(employeePage.getByRole('row', { name: /Train client Lille/ })).toContainText('approuvée')

  // 5. Le manager (racine) soumet une note ; la RH la rejette.
  await submitExpense(managerPage, 'Dîner fournisseur', '150')
  await hrPage.goto('/hr')
  const hrRow = hrPage.getByRole('row', { name: /Dîner fournisseur/ })
  await expect(hrRow).toContainText('Marc Manager')
  await hrRow.getByRole('button', { name: 'Rejeter' }).click()
  await expect(
    hrPage.getByRole('heading', { name: 'Notes des managers racine en attente (0)' })
  ).toBeVisible()
  await managerPage.goto('/expenses')
  await expect(managerPage.getByRole('row', { name: /Dîner fournisseur/ })).toContainText('rejetée')
}

test('[FLOW-01] parcours complet via l’interface : inscriptions, rattachement, soumission, validation manager puis RH', async ({
  openPage,
}) => {
  test.slow()
  await runJourney(openPage)
})
