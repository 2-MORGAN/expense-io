import type { Page } from '@playwright/test'
import {
  expectApiError,
  expectNoteShape,
  statusOf,
  UNKNOWN_ID,
  type NoteStatus,
} from './support/api'
import { addUser, createOrg, expect, test } from './support/fixtures'

const STATUS_LABELS: Record<NoteStatus, string> = {
  pending: 'en attente',
  approved: 'approuvée',
  rejected: 'rejetée',
}

async function expectEmployeeSeesStatus(
  page: Page,
  description: string,
  status: NoteStatus
): Promise<void> {
  await page.goto('/expenses')
  await expect(page.getByRole('row', { name: new RegExp(description) }).getByRole('cell').nth(3)).toHaveText(
    STATUS_LABELS[status]
  )
}

test.describe('Validation par le manager — interface', () => {
  test('[MGR-01] /manager liste les notes en attente des subordonnés directs', async ({
    org,
    apiAs,
    pageAs,
  }) => {
    await (await apiAs(org.employee)).submitNote({
      description: 'Train Paris-Lyon',
      amount: '89.9',
      expenseDate: '2026-09-30',
    })

    const page = await pageAs(org.manager)
    await page.goto('/manager')
    await expect(page.getByRole('heading', { name: 'Validation des notes de frais' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'En attente (1)' })).toBeVisible()
    await expect(page.getByRole('row', { name: /Train Paris-Lyon/ }).getByRole('cell')).toHaveText([
      `${org.employee.id.slice(0, 8)}…`,
      '30 sept. 2026',
      'Train Paris-Lyon',
      '89,90 €',
      /Voir le reçu\s*Approuver\s*Rejeter/,
    ])
  })

  test('[MGR-02] sans note en attente : « Aucune note en attente. »', async ({ org, pageAs }) => {
    const page = await pageAs(org.manager)
    await page.goto('/manager')
    await expect(page.getByRole('heading', { name: 'En attente (0)' })).toBeVisible()
    await expect(page.getByText('Aucune note en attente.')).toBeVisible()
  })

  test('[MGR-03] « Approuver » → la note quitte la liste et l’employé la voit « approuvée »', async ({
    org,
    apiAs,
    pageAs,
  }) => {
    await (await apiAs(org.employee)).submitNote({ description: 'Dîner équipe' })

    const managerPage = await pageAs(org.manager)
    await managerPage.goto('/manager')
    await managerPage
      .getByRole('row', { name: /Dîner équipe/ })
      .getByRole('button', { name: 'Approuver' })
      .click()
    await expect(managerPage.getByRole('row', { name: /Dîner équipe/ })).toHaveCount(0)
    await expect(managerPage.getByRole('heading', { name: 'En attente (0)' })).toBeVisible()
    await expect(managerPage.getByRole('main').getByRole('alert')).toHaveCount(0)

    await expectEmployeeSeesStatus(await pageAs(org.employee), 'Dîner équipe', 'approved')
  })

  test('[MGR-04] « Rejeter » → la note quitte la liste et l’employé la voit « rejetée »', async ({
    org,
    apiAs,
    pageAs,
  }) => {
    await (await apiAs(org.employee)).submitNote({ description: 'Parking non justifié' })

    const managerPage = await pageAs(org.manager)
    await managerPage.goto('/manager')
    await managerPage
      .getByRole('row', { name: /Parking non justifié/ })
      .getByRole('button', { name: 'Rejeter' })
      .click()
    await expect(managerPage.getByRole('row', { name: /Parking non justifié/ })).toHaveCount(0)
    await expect(managerPage.getByText('Aucune note en attente.')).toBeVisible()

    await expectEmployeeSeesStatus(await pageAs(org.employee), 'Parking non justifié', 'rejected')
  })

  test('[MGR-05] note déjà tranchée entre-temps → message « Already decided » affiché', async ({
    org,
    apiAs,
    pageAs,
  }) => {
    const note = await (await apiAs(org.employee)).submitNote({ description: 'Double décision' })
    const managerPage = await pageAs(org.manager)
    await managerPage.goto('/manager')
    await expect(managerPage.getByRole('row', { name: /Double décision/ })).toBeVisible()

    // Décision prise ailleurs (autre onglet) pendant que la page est ouverte.
    expect((await (await apiAs(org.manager)).managerDecide(note.id, 'reject')).status()).toBe(200)

    await managerPage
      .getByRole('row', { name: /Double décision/ })
      .getByRole('button', { name: 'Approuver' })
      .click()
    await expect(managerPage.getByRole('main').getByRole('alert')).toHaveText('Already decided')
  })
})

test.describe('Validation par le manager — API', () => {
  test('[MGR-06] GET /api/manager/expense-notes : notes « pending » des subordonnés directs, plus anciennes d’abord', async ({
    org,
    apiAs,
  }) => {
    const colleague = await addUser(org, {
      name: 'Colin Collegue',
      role: 'employee',
      managerId: org.manager.id,
    })
    const subManager = await addUser(org, {
      name: 'Sacha Sousmanager',
      role: 'manager',
      managerId: org.manager.id,
    })
    const subEmployee = await addUser(org, {
      name: 'Ines Indirecte',
      role: 'employee',
      managerId: subManager.id,
    })
    const otherManager = await addUser(org, { name: 'Oscar Autremanager', role: 'manager' })
    const otherTeamEmployee = await addUser(org, {
      name: 'Paul Autreequipe',
      role: 'employee',
      managerId: otherManager.id,
    })
    const otherCompany = await createOrg('mgr-06-autre')

    const employeeApi = await apiAs(org.employee)
    const first = await employeeApi.submitNote({ description: 'Employé 1' })
    const decided = await employeeApi.submitNote({ description: 'Employé déjà tranchée' })
    const colleagueNote = await (await apiAs(colleague)).submitNote({ description: 'Collègue' })
    const subManagerNote = await (await apiAs(subManager)).submitNote({ description: 'Sous-manager' })
    await (await apiAs(subEmployee)).submitNote({ description: 'N+2' })
    await (await apiAs(org.manager)).submitNote({ description: 'Sa propre note' })
    await (await apiAs(otherTeamEmployee)).submitNote({ description: 'Autre équipe' })
    await (await apiAs(otherCompany.employee)).submitNote({ description: 'Autre entreprise' })

    const managerApi = await apiAs(org.manager)
    expect((await managerApi.managerDecide(decided.id, 'approve')).status()).toBe(200)

    const pending = await managerApi.managerPending()
    expect(pending.map((note) => note.id)).toEqual([first.id, colleagueNote.id, subManagerNote.id])
    for (const note of pending) {
      expectNoteShape(note)
      expect(note.status).toBe('pending')
    }
    expect(pending[0]).toMatchObject({
      userId: org.employee.id,
      description: 'Employé 1',
      amount: 42.5,
      expenseDate: '2026-10-01',
    })
  })

  test('[MGR-07] approve → 200 et note « approved » ; nouvelle décision → 409 « Already decided »', async ({
    org,
    apiAs,
  }) => {
    const employeeApi = await apiAs(org.employee)
    const note = await employeeApi.submitNote({ description: 'À approuver', amount: '18.4' })
    const managerApi = await apiAs(org.manager)

    const response = await managerApi.managerDecide(note.id, 'approve')
    expect(response.status()).toBe(200)
    const decided = await response.json()
    expectNoteShape(decided)
    expect(decided).toMatchObject({ ...note, status: 'approved' })

    await expectApiError(await managerApi.managerDecide(note.id, 'approve'), 409, 'Already decided')
    await expectApiError(await managerApi.managerDecide(note.id, 'reject'), 409, 'Already decided')
    expect((await employeeApi.notes())[0].status).toBe('approved')
    expect(await managerApi.managerPending()).toEqual([])
  })

  test('[MGR-08] reject → 200 et note « rejected » ; nouvelle décision → 409 « Already decided »', async ({
    org,
    apiAs,
  }) => {
    const employeeApi = await apiAs(org.employee)
    const note = await employeeApi.submitNote({ description: 'À rejeter' })
    const managerApi = await apiAs(org.manager)

    const response = await managerApi.managerDecide(note.id, 'reject')
    expect(response.status()).toBe(200)
    expect(await response.json()).toMatchObject({ ...note, status: 'rejected' })

    await expectApiError(await managerApi.managerDecide(note.id, 'approve'), 409, 'Already decided')
    await expectApiError(await managerApi.managerDecide(note.id, 'reject'), 409, 'Already decided')
    expect((await employeeApi.notes())[0].status).toBe('rejected')
  })

  test('[MGR-09] note hors de son équipe → 404 « Not found », statut inchangé', async ({
    org,
    apiAs,
  }) => {
    const otherManager = await addUser(org, { name: 'Oscar Autremanager', role: 'manager' })
    const otherTeamEmployee = await addUser(org, {
      name: 'Paul Autreequipe',
      role: 'employee',
      managerId: otherManager.id,
    })
    const otherTeamNote = await (await apiAs(otherTeamEmployee)).submitNote()
    const ownNote = await (await apiAs(org.manager)).submitNote()
    const managerApi = await apiAs(org.manager)

    for (const decision of ['approve', 'reject'] as const) {
      for (const id of [otherTeamNote.id, ownNote.id, UNKNOWN_ID]) {
        await expectApiError(await managerApi.managerDecide(id, decision), 404, 'Not found')
      }
    }
    expect(await statusOf(await apiAs(otherTeamEmployee), otherTeamNote.id)).toBe('pending')
    expect(await statusOf(await apiAs(org.manager), ownNote.id)).toBe('pending')
  })

  test('[MGR-10] manager non racine : ses notes sont tranchées par son propre manager, pas par la RH', async ({
    org,
    apiAs,
  }) => {
    const subManager = await addUser(org, {
      name: 'Sacha Sousmanager',
      role: 'manager',
      managerId: org.manager.id,
    })
    const note = await (await apiAs(subManager)).submitNote({ description: 'Note du sous-manager' })

    const hrApi = await apiAs(org.hr)
    expect((await hrApi.hrPending()).map((pending) => pending.id)).not.toContain(note.id)
    await expectApiError(await hrApi.hrDecide(note.id, 'approve'), 404, 'Not found')

    const managerApi = await apiAs(org.manager)
    expect((await managerApi.managerPending()).map((pending) => pending.id)).toEqual([note.id])
    expect((await managerApi.managerDecide(note.id, 'approve')).status()).toBe(200)
    expect(await statusOf(await apiAs(subManager), note.id)).toBe('approved')
  })
})
