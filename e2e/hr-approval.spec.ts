import { expectApiError, expectNoteShape, statusOf, UNKNOWN_ID } from './support/api'
import { addUser, createOrg, expect, test } from './support/fixtures'

test.describe('Validation par la RH — interface', () => {
  test('[RH-01] /hr liste les notes en attente des managers racine (auteur, date, description, montant)', async ({
    org,
    apiAs,
    pageAs,
  }) => {
    await (await apiAs(org.manager)).submitNote({
      description: 'Café client',
      amount: '5.9',
      expenseDate: '2026-10-02',
    })

    const page = await pageAs(org.hr)
    await page.goto('/hr')
    await expect(page.getByRole('heading', { name: 'Notes des managers racine en attente (1)' })).toBeVisible()
    await expect(page.getByRole('row', { name: /Café client/ }).getByRole('cell')).toHaveText([
      org.manager.name,
      '2 oct. 2026',
      'Café client',
      '5,90 €',
      /Voir le reçu\s*Approuver\s*Rejeter/,
    ])
  })

  test('[RH-02] sans note en attente : « Aucune note en attente. »', async ({ org, pageAs }) => {
    const page = await pageAs(org.hr)
    await page.goto('/hr')
    await expect(page.getByRole('heading', { name: 'Notes des managers racine en attente (0)' })).toBeVisible()
    await expect(page.getByText('Aucune note en attente.')).toBeVisible()
  })

  test('[RH-03] « Approuver » → la note quitte la liste et le manager la voit « approuvée »', async ({
    org,
    apiAs,
    pageAs,
  }) => {
    await (await apiAs(org.manager)).submitNote({ description: 'Séminaire direction' })

    const hrPage = await pageAs(org.hr)
    await hrPage.goto('/hr')
    await hrPage
      .getByRole('row', { name: /Séminaire direction/ })
      .getByRole('button', { name: 'Approuver' })
      .click()
    await expect(hrPage.getByRole('row', { name: /Séminaire direction/ })).toHaveCount(0)
    await expect(hrPage.getByRole('heading', { name: 'Notes des managers racine en attente (0)' })).toBeVisible()

    const managerPage = await pageAs(org.manager)
    await managerPage.goto('/expenses')
    await expect(
      managerPage.getByRole('row', { name: /Séminaire direction/ }).getByRole('cell').nth(3)
    ).toHaveText('approuvée')
  })

  test('[RH-04] « Rejeter » → la note quitte la liste et le manager la voit « rejetée »', async ({
    org,
    apiAs,
    pageAs,
  }) => {
    await (await apiAs(org.manager)).submitNote({ description: 'Taxi sans reçu lisible' })

    const hrPage = await pageAs(org.hr)
    await hrPage.goto('/hr')
    await hrPage
      .getByRole('row', { name: /Taxi sans reçu lisible/ })
      .getByRole('button', { name: 'Rejeter' })
      .click()
    await expect(hrPage.getByRole('row', { name: /Taxi sans reçu lisible/ })).toHaveCount(0)
    await expect(hrPage.getByText('Aucune note en attente.')).toBeVisible()

    const managerPage = await pageAs(org.manager)
    await managerPage.goto('/expenses')
    await expect(
      managerPage.getByRole('row', { name: /Taxi sans reçu lisible/ }).getByRole('cell').nth(3)
    ).toHaveText('rejetée')
  })
})

test.describe('Validation par la RH — API', () => {
  test('[RH-05] GET /api/hr/expense-notes : notes « pending » des managers racine de l’entreprise, plus anciennes d’abord', async ({
    org,
    apiAs,
  }) => {
    const secondRootManager = await addUser(org, { name: 'Bruno Second', role: 'manager' })
    const subManager = await addUser(org, {
      name: 'Sacha Sousmanager',
      role: 'manager',
      managerId: org.manager.id,
    })
    const otherCompany = await createOrg('rh-05-autre')

    const managerApi = await apiAs(org.manager)
    const first = await managerApi.submitNote({ description: 'Racine 1' })
    const decided = await managerApi.submitNote({ description: 'Racine déjà tranchée' })
    const second = await (await apiAs(secondRootManager)).submitNote({ description: 'Racine 2' })
    await (await apiAs(org.employee)).submitNote({ description: 'Employé' })
    await (await apiAs(subManager)).submitNote({ description: 'Manager non racine' })
    await (await apiAs(otherCompany.manager)).submitNote({ description: 'Autre entreprise' })

    const hrApi = await apiAs(org.hr)
    expect((await hrApi.hrDecide(decided.id, 'reject')).status()).toBe(200)

    const pending = await hrApi.hrPending()
    expect(pending.map((note) => note.id)).toEqual([first.id, second.id])
    for (const note of pending) {
      expectNoteShape(note)
      expect(note.status).toBe('pending')
    }
    expect(pending[0]).toMatchObject({ userId: org.manager.id, description: 'Racine 1' })
  })

  test('[RH-06] approve → 200 et note « approved » ; nouvelle décision → 409 « Already decided »', async ({
    org,
    apiAs,
  }) => {
    const managerApi = await apiAs(org.manager)
    const note = await managerApi.submitNote({ description: 'À approuver par la RH', amount: '77.7' })
    const hrApi = await apiAs(org.hr)

    const response = await hrApi.hrDecide(note.id, 'approve')
    expect(response.status()).toBe(200)
    const decided = await response.json()
    expectNoteShape(decided)
    expect(decided).toMatchObject({ ...note, status: 'approved' })

    await expectApiError(await hrApi.hrDecide(note.id, 'approve'), 409, 'Already decided')
    await expectApiError(await hrApi.hrDecide(note.id, 'reject'), 409, 'Already decided')
    expect(await statusOf(managerApi, note.id)).toBe('approved')
    expect(await hrApi.hrPending()).toEqual([])
  })

  test('[RH-07] reject → 200 et note « rejected » ; nouvelle décision → 409 « Already decided »', async ({
    org,
    apiAs,
  }) => {
    const managerApi = await apiAs(org.manager)
    const note = await managerApi.submitNote({ description: 'À rejeter par la RH' })
    const hrApi = await apiAs(org.hr)

    const response = await hrApi.hrDecide(note.id, 'reject')
    expect(response.status()).toBe(200)
    expect(await response.json()).toMatchObject({ ...note, status: 'rejected' })

    await expectApiError(await hrApi.hrDecide(note.id, 'approve'), 409, 'Already decided')
    expect(await statusOf(managerApi, note.id)).toBe('rejected')
  })

  test('[RH-08] note d’employé, de manager non racine, d’une autre entreprise ou inconnue → 404, statut inchangé', async ({
    org,
    apiAs,
  }) => {
    const subManager = await addUser(org, {
      name: 'Sacha Sousmanager',
      role: 'manager',
      managerId: org.manager.id,
    })
    const otherCompany = await createOrg('rh-08-autre')
    const employeeApi = await apiAs(org.employee)
    const subManagerApi = await apiAs(subManager)
    const otherManagerApi = await apiAs(otherCompany.manager)
    const employeeNote = await employeeApi.submitNote()
    const subManagerNote = await subManagerApi.submitNote()
    const otherCompanyNote = await otherManagerApi.submitNote()
    const hrApi = await apiAs(org.hr)

    for (const decision of ['approve', 'reject'] as const) {
      for (const id of [employeeNote.id, subManagerNote.id, otherCompanyNote.id, UNKNOWN_ID]) {
        await expectApiError(await hrApi.hrDecide(id, decision), 404, 'Not found')
      }
    }
    expect(await statusOf(employeeApi, employeeNote.id)).toBe('pending')
    expect(await statusOf(subManagerApi, subManagerNote.id)).toBe('pending')
    expect(await statusOf(otherManagerApi, otherCompanyNote.id)).toBe('pending')
  })
})
