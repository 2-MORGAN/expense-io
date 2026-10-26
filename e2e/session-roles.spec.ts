import { deleteUser, setRole } from './support/db'
import { addUser, expect, test } from './support/fixtures'

// S9 (ADR-001 §4, 2-496) : le rôle est relu en base à chaque requête, un
// compte supprimé perd sa session, et la session expire après 8 h
// d'inactivité. Aucune reconnexion dans ces tests.

const SESSION_COOKIE = 'authjs.session-token'
const EIGHT_HOURS_S = 8 * 60 * 60
const TOLERANCE_S = 5 * 60

test.describe('Session et rôle à jour (S9)', () => {
  test('[AUTH-10a] manager rétrogradé en base → 403 sur les routes manager et page refusée, sans reconnexion', async ({
    org,
    apiAs,
    pageAs,
  }) => {
    const api = await apiAs(org.manager)
    const page = await pageAs(org.manager)
    expect((await api.managerPendingResponse()).status()).toBe(200)
    await page.goto('/manager')
    await expect(page.getByRole('banner').getByRole('link', { name: 'Manager', exact: true })).toBeVisible()

    await setRole(org.manager.id, 'employee')

    const refused = await api.managerPendingResponse()
    expect(refused.status()).toBe(403)
    await page.goto('/manager')
    await expect(page.getByRole('heading', { name: 'Accès réservé aux managers' })).toBeVisible()
    await expect(page.getByRole('banner').getByRole('link', { name: 'Manager', exact: true })).toHaveCount(0)
  })

  test('[AUTH-10b] employé promu manager en base → accès manager immédiat, sans reconnexion', async ({
    org,
    apiAs,
  }) => {
    const api = await apiAs(org.employee)
    expect((await api.managerPendingResponse()).status()).toBe(403)

    await setRole(org.employee.id, 'manager')

    expect((await api.managerPendingResponse()).status()).toBe(200)
  })

  test('[AUTH-10c] compte supprimé en base → 401 sur l’API et retour à /login', async ({ org, apiAs, pageAs }) => {
    const user = await addUser(org, { name: 'Sam Supprime', role: 'employee' })
    const api = await apiAs(user)
    const page = await pageAs(user)
    expect((await api.listNotes()).status()).toBe(200)

    await deleteUser(user.id)

    expect((await api.listNotes()).status()).toBe(401)
    await page.goto('/expenses')
    await expect(page).toHaveURL(/\/login$/)
  })

  test('[AUTH-10d] le cookie de session expire 8 h après la dernière requête, pas 30 jours', async ({
    org,
    pageAs,
  }) => {
    const page = await pageAs(org.employee)
    const before = Date.now() / 1000
    await page.goto('/expenses')
    const cookie = (await page.context().cookies()).find((c) => c.name === SESSION_COOKIE)
    expect(cookie, SESSION_COOKIE).toBeDefined()
    expect(cookie!.expires).toBeGreaterThan(before + EIGHT_HOURS_S - TOLERANCE_S)
    expect(cookie!.expires).toBeLessThan(Date.now() / 1000 + EIGHT_HOURS_S + TOLERANCE_S)
  })
})
