import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { request as playwrightRequest } from '@playwright/test'
import { signInWithCredentials, type CompanyUserDto } from './support/api'
import type { TestUser } from './support/db'
import { AUTH_TIMEOUT, expect, signIn, test } from './support/fixtures'

test.describe('Connexion et session', () => {
  test('[AUTH-01] identifiants valides → /expenses, email et bouton de déconnexion dans l’en-tête', async ({
    page,
    org,
  }) => {
    await page.goto('/login')
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible()
    await page.getByLabel('Email').fill(org.employee.email)
    await page.getByLabel('Mot de passe').fill(org.employee.password)
    await page.getByRole('button', { name: 'Se connecter' }).click()

    await expect(page).toHaveURL(/\/expenses$/, { timeout: AUTH_TIMEOUT })
    await expect(page.getByRole('heading', { name: 'Mes notes de frais' })).toBeVisible()
    const banner = page.getByRole('banner')
    await expect(banner).toContainText(org.employee.email)
    await expect(banner.getByRole('button', { name: 'Se déconnecter' })).toBeVisible()
  })

  test('[AUTH-02] mauvais mot de passe → « Email ou mot de passe incorrect. », reste sur /login', async ({
    page,
    org,
  }) => {
    await page.goto('/login')
    await page.getByLabel('Email').fill(org.employee.email)
    await page.getByLabel('Mot de passe').fill('pas-le-bon-mot-de-passe')
    await page.getByRole('button', { name: 'Se connecter' }).click()

    await expect(page.getByRole('main').getByRole('alert')).toHaveText(
      'Email ou mot de passe incorrect.',
      { timeout: AUTH_TIMEOUT }
    )
    await expect(page).toHaveURL(/\/login$/)
    expect((await page.request.get('/api/expense-notes')).status()).toBe(401)
  })

  test('[AUTH-03] email inconnu → même message générique', async ({ page, org }) => {
    await page.goto('/login')
    await page.getByLabel('Email').fill(`inconnu@${org.company.domain}`)
    await page.getByLabel('Mot de passe').fill(org.employee.password)
    await page.getByRole('button', { name: 'Se connecter' }).click()

    await expect(page.getByRole('main').getByRole('alert')).toHaveText(
      'Email ou mot de passe incorrect.',
      { timeout: AUTH_TIMEOUT }
    )
    await expect(page).toHaveURL(/\/login$/)
  })

  test('[AUTH-04] déconnexion → /login, puis pages et API de nouveau inaccessibles', async ({
    page,
    org,
  }) => {
    await signIn(page, org.employee)
    await page.goto('/expenses')
    await page.getByRole('banner').getByRole('button', { name: 'Se déconnecter' }).click()

    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByRole('banner').getByRole('button', { name: 'Se déconnecter' })).toHaveCount(0)
    await page.goto('/expenses')
    await expect(page).toHaveURL(/\/login$/)
    expect((await page.request.get('/api/expense-notes')).status()).toBe(401)
  })

  test('[AUTH-05] sans session, /expenses, /manager et /hr redirigent vers /login', async ({ page }) => {
    for (const protectedPath of ['/expenses', '/manager', '/hr']) {
      await page.goto(protectedPath)
      await expect(page, protectedPath).toHaveURL(/\/login$/)
      await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible()
    }
  })

  test('[AUTH-06] accueil : liens de connexion/inscription si anonyme, redirection /expenses si connecté', async ({
    page,
    org,
  }) => {
    await page.goto('/')
    const main = page.getByRole('main')
    await expect(main.getByRole('heading', { name: 'Expense.io' })).toBeVisible()
    await expect(main.getByRole('link', { name: 'Se connecter' })).toHaveAttribute('href', '/login')
    await expect(main.getByRole('link', { name: 'Créer un compte' })).toHaveAttribute('href', '/signup')

    await main.getByRole('link', { name: 'Créer un compte' }).click()
    await expect(page).toHaveURL(/\/signup$/)

    await signIn(page, org.employee)
    await page.goto('/')
    await expect(page).toHaveURL(/\/expenses$/)
  })

  test('[AUTH-07] navigation selon le rôle : liens Manager / RH et pages réservées', async ({
    org,
    pageAs,
  }) => {
    const expectations: Array<{
      user: TestUser
      links: { Manager: number; RH: number }
      manager: string
      hr: string
    }> = [
      {
        user: org.employee,
        links: { Manager: 0, RH: 0 },
        manager: 'Accès réservé aux managers',
        hr: 'Accès réservé aux RH',
      },
      {
        user: org.manager,
        links: { Manager: 1, RH: 0 },
        manager: 'Validation des notes de frais',
        hr: 'Accès réservé aux RH',
      },
      {
        user: org.hr,
        links: { Manager: 0, RH: 1 },
        manager: 'Accès réservé aux managers',
        hr: 'Espace RH',
      },
    ]

    for (const { user, links, manager, hr } of expectations) {
      const page = await pageAs(user)
      await page.goto('/expenses')
      const banner = page.getByRole('banner')
      await expect(banner).toContainText(user.email)
      await expect(banner.getByRole('link', { name: 'Manager', exact: true })).toHaveCount(links.Manager)
      await expect(banner.getByRole('link', { name: 'RH', exact: true })).toHaveCount(links.RH)

      await page.goto('/manager')
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(manager)
      await page.goto('/hr')
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(hr)
    }
  })

  test('[AUTH-08] liens de navigation Manager et RH mènent aux espaces correspondants', async ({
    org,
    pageAs,
  }) => {
    const managerPage = await pageAs(org.manager)
    await managerPage.goto('/expenses')
    await managerPage.getByRole('banner').getByRole('link', { name: 'Manager' }).click()
    await expect(managerPage).toHaveURL(/\/manager$/)
    await expect(managerPage.getByRole('banner').getByRole('link', { name: 'Manager' })).toHaveAttribute(
      'aria-current',
      'page'
    )

    const hrPage = await pageAs(org.hr)
    await hrPage.goto('/expenses')
    await hrPage.getByRole('banner').getByRole('link', { name: 'RH' }).click()
    await expect(hrPage).toHaveURL(/\/hr$/)
    await expect(hrPage.getByRole('heading', { name: 'Espace RH' })).toBeVisible()
  })
})

test.describe('Comptes de démonstration', () => {
  test('[AUTH-09] `npm run seed` est rejouable et ses trois comptes se connectent avec le bon rôle', async ({
    baseURL,
  }) => {
    const projectRoot = path.resolve(__dirname, '..')
    // Deux exécutions : le seed doit rester idempotent.
    for (let run = 0; run < 2; run++) {
      execFileSync(process.execPath, ['scripts/seed.mjs'], {
        cwd: projectRoot,
        env: process.env,
        stdio: 'pipe',
      })
    }

    const accounts = {
      hr: {
        email: process.env.SEED_HR_EMAIL ?? 'hr@expense.io',
        password: process.env.SEED_HR_PASSWORD ?? 'hr1234',
      },
      manager: {
        email: process.env.SEED_MANAGER_EMAIL ?? 'manager@expense.io',
        password: process.env.SEED_MANAGER_PASSWORD ?? 'manager1234',
      },
      employee: {
        email: process.env.SEED_EMPLOYEE_EMAIL ?? 'demo@expense.io',
        password: process.env.SEED_EMPLOYEE_PASSWORD ?? 'demo1234',
      },
    }

    const sessions: Record<string, { email: string; role: string; id: string }> = {}
    for (const [key, account] of Object.entries(accounts)) {
      const context = await playwrightRequest.newContext({ baseURL })
      await signInWithCredentials(context, account.email, account.password)
      const session = (await (await context.get('/api/auth/session')).json()) as {
        user: { email: string; role: string; id: string }
      }
      sessions[key] = session.user
      await context.dispose()
    }
    expect(sessions.hr).toMatchObject({ email: accounts.hr.email, role: 'hr_admin' })
    expect(sessions.manager).toMatchObject({ email: accounts.manager.email, role: 'manager' })
    expect(sessions.employee).toMatchObject({ email: accounts.employee.email, role: 'employee' })

    // Organigramme vu par la RH : employé rattaché au manager, manager racine.
    const hrContext = await playwrightRequest.newContext({ baseURL })
    await signInWithCredentials(hrContext, accounts.hr.email, accounts.hr.password)
    const usersResponse = await hrContext.get('/api/hr/users')
    expect(usersResponse.status()).toBe(200)
    const users = (await usersResponse.json()) as CompanyUserDto[]
    expect(users.find((user) => user.id === sessions.employee.id)?.managerId).toBe(sessions.manager.id)
    expect(users.find((user) => user.id === sessions.manager.id)?.managerId).toBeNull()
    await hrContext.dispose()
  })
})
