import type { Locator, Page } from '@playwright/test'
import { expectApiError, expectUserShape, UNKNOWN_ID } from './support/api'
import type { TestUser } from './support/db'
import { addUser, createOrg, expect, test } from './support/fixtures'

const NO_MANAGER = '— aucun (racine) —'

function orgChartRow(page: Page, user: TestUser): Locator {
  return page
    .getByRole('row')
    .filter({ has: page.getByRole('combobox') })
    .filter({ hasText: user.email })
}

/** Choisit un manager dans l'organigramme et attend la réponse de l'API. */
async function chooseManager(page: Page, user: TestUser, optionLabel: string): Promise<void> {
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      response.url().endsWith(`/api/hr/users/${user.id}/manager`)
  )
  await orgChartRow(page, user).getByRole('combobox').selectOption({ label: optionLabel })
  expect((await saved).status()).toBe(200)
}

test.describe('Rattachement d’un manager — interface RH', () => {
  test('[ORG-01] l’organigramme liste employés et managers de l’entreprise, triés par nom, avec leur manager', async ({
    org,
    pageAs,
  }) => {
    const secondManager = await addUser(org, { name: 'Bruno Second', role: 'manager' })
    const newcomer = await addUser(org, { name: 'Alice Nouvelle', role: 'employee' })
    await createOrg('org-01-autre')

    const page = await pageAs(org.hr)
    await page.goto('/hr')
    await expect(page.getByRole('heading', { name: 'Organigramme (4)' })).toBeVisible()
    const rows = page.getByRole('row').filter({ has: page.getByRole('combobox') })
    await expect(rows).toHaveCount(4)
    const expected: Array<[TestUser, string, string]> = [
      [newcomer, 'employee', ''],
      [secondManager, 'manager', ''],
      [org.employee, 'employee', org.manager.id],
      [org.manager, 'manager', ''],
    ]
    for (const [index, [user, role, managerId]] of expected.entries()) {
      const row = rows.nth(index)
      await expect(row.getByRole('cell').nth(0)).toContainText(user.name)
      await expect(row.getByRole('cell').nth(0)).toContainText(user.email)
      await expect(row.getByRole('cell').nth(1)).toHaveText(role)
      await expect(row.getByRole('combobox')).toHaveValue(managerId)
    }
    await expect(page.getByRole('row').filter({ hasText: org.hr.email })).toHaveCount(0)

    // Choix proposés : « aucun » + les managers de l'entreprise, sauf soi-même.
    await expect(orgChartRow(page, org.employee).locator('option')).toHaveText([
      NO_MANAGER,
      secondManager.name,
      org.manager.name,
    ])
    await expect(orgChartRow(page, org.manager).locator('option')).toHaveText([
      NO_MANAGER,
      secondManager.name,
    ])
  })

  test('[ORG-02] rattacher un employé à un manager → enregistré, et le manager voit ses notes en attente', async ({
    org,
    apiAs,
    pageAs,
  }) => {
    const newcomer = await addUser(org, { name: 'Alice Nouvelle', role: 'employee' })
    await (await apiAs(newcomer)).submitNote({ description: 'Note avant rattachement' })
    const managerApi = await apiAs(org.manager)
    expect(await managerApi.managerPending()).toEqual([])

    const page = await pageAs(org.hr)
    await page.goto('/hr')
    await chooseManager(page, newcomer, org.manager.name)
    await expect(orgChartRow(page, newcomer).getByRole('combobox')).toHaveValue(org.manager.id)
    await page.reload()
    await expect(orgChartRow(page, newcomer).getByRole('combobox')).toHaveValue(org.manager.id)

    const managerPage = await pageAs(org.manager)
    await managerPage.goto('/manager')
    await expect(managerPage.getByRole('row', { name: /Note avant rattachement/ })).toBeVisible()
  })

  test('[ORG-03] « aucun (racine) » détache l’employé : son ancien manager ne voit plus ses notes', async ({
    org,
    apiAs,
    pageAs,
  }) => {
    await (await apiAs(org.employee)).submitNote({ description: 'Note avant détachement' })
    const managerApi = await apiAs(org.manager)
    expect(await managerApi.managerPending()).toHaveLength(1)

    const page = await pageAs(org.hr)
    await page.goto('/hr')
    await chooseManager(page, org.employee, NO_MANAGER)
    await page.reload()
    await expect(orgChartRow(page, org.employee).getByRole('combobox')).toHaveValue('')

    expect(await managerApi.managerPending()).toEqual([])
  })

  test('[ORG-04] rattacher un manager racine à un autre manager → ses notes passent de la RH à ce manager', async ({
    org,
    apiAs,
    pageAs,
  }) => {
    const secondManager = await addUser(org, { name: 'Bruno Second', role: 'manager' })
    await (await apiAs(secondManager)).submitNote({ description: 'Note de Bruno' })

    const page = await pageAs(org.hr)
    await page.goto('/hr')
    await expect(page.getByRole('row', { name: /Note de Bruno/ })).toBeVisible()
    await chooseManager(page, secondManager, org.manager.name)
    await page.reload()
    await expect(orgChartRow(page, secondManager).getByRole('combobox')).toHaveValue(org.manager.id)
    await expect(page.getByRole('heading', { name: 'Notes des managers racine en attente (0)' })).toBeVisible()

    const managerPage = await pageAs(org.manager)
    await managerPage.goto('/manager')
    await expect(managerPage.getByRole('row', { name: /Note de Bruno/ })).toBeVisible()
  })
})

test.describe('Rattachement d’un manager — API', () => {
  test('[ORG-05] GET /api/hr/users : employés et managers de l’entreprise uniquement, triés par nom', async ({
    org,
    apiAs,
  }) => {
    const otherCompany = await createOrg('org-05-autre')
    const newcomer = await addUser(org, { name: 'Alice Nouvelle', role: 'employee' })

    const users = await (await apiAs(org.hr)).hrUsers()
    expect(users.map((user) => user.id)).toEqual([newcomer.id, org.employee.id, org.manager.id])
    users.forEach(expectUserShape)
    expect(users[1]).toMatchObject({
      id: org.employee.id,
      name: org.employee.name,
      email: org.employee.email,
      role: 'employee',
      managerId: org.manager.id,
    })
    expect(users[2]).toMatchObject({ id: org.manager.id, role: 'manager', managerId: null })
    const ids = users.map((user) => user.id)
    expect(ids).not.toContain(org.hr.id)
    expect(ids).not.toContain(otherCompany.employee.id)
  })

  test('[ORG-06] PUT /api/hr/users/:id/manager → 200 et utilisateur à jour ; managerId null → détachement', async ({
    org,
    apiAs,
  }) => {
    const secondManager = await addUser(org, { name: 'Bruno Second', role: 'manager' })
    const employeeApi = await apiAs(org.employee)
    const note = await employeeApi.submitNote({ description: 'Note suivie' })
    const hrApi = await apiAs(org.hr)
    const firstManagerApi = await apiAs(org.manager)
    const secondManagerApi = await apiAs(secondManager)

    const reassigned = await hrApi.setManager(org.employee.id, secondManager.id)
    expect(reassigned.status()).toBe(200)
    expect(await reassigned.json()).toMatchObject({
      id: org.employee.id,
      name: org.employee.name,
      email: org.employee.email,
      role: 'employee',
      managerId: secondManager.id,
    })
    expect(await firstManagerApi.managerPending()).toEqual([])
    expect((await secondManagerApi.managerPending()).map((pending) => pending.id)).toEqual([note.id])
    await expectApiError(await firstManagerApi.managerDecide(note.id, 'approve'), 404, 'Not found')

    const detached = await hrApi.setManager(org.employee.id, null)
    expect(detached.status()).toBe(200)
    expect(await detached.json()).toMatchObject({ id: org.employee.id, managerId: null })
    expect(await secondManagerApi.managerPending()).toEqual([])
    expect((await hrApi.hrUsers()).find((user) => user.id === org.employee.id)?.managerId).toBeNull()
  })

  test('[ORG-07] manager invalide (soi-même, non-manager, inconnu) → 409 « Invalid manager », rien ne change', async ({
    org,
    apiAs,
  }) => {
    const colleague = await addUser(org, {
      name: 'Colin Collegue',
      role: 'employee',
      managerId: org.manager.id,
    })
    const hrApi = await apiAs(org.hr)

    for (const [target, managerId] of [
      [org.employee, org.employee.id],
      [org.manager, org.manager.id],
      [org.employee, colleague.id],
      [org.employee, org.hr.id],
      [org.employee, UNKNOWN_ID],
    ] as const) {
      await expectApiError(await hrApi.setManager(target.id, managerId), 409, 'Invalid manager')
    }
    const users = await hrApi.hrUsers()
    expect(users.find((user) => user.id === org.employee.id)?.managerId).toBe(org.manager.id)
    expect(users.find((user) => user.id === org.manager.id)?.managerId).toBeNull()
  })

  test('[ORG-08] cible RH, d’une autre entreprise ou inconnue → 404 « Not found »', async ({
    org,
    apiAs,
  }) => {
    const otherCompany = await createOrg('org-08-autre')
    const hrApi = await apiAs(org.hr)

    for (const targetId of [org.hr.id, otherCompany.employee.id, UNKNOWN_ID]) {
      await expectApiError(await hrApi.setManager(targetId, org.manager.id), 404, 'Not found')
    }
    const otherUsers = await (await apiAs(otherCompany.hr)).hrUsers()
    expect(otherUsers.find((user) => user.id === otherCompany.employee.id)?.managerId).toBe(
      otherCompany.manager.id
    )
  })
})
