import type { APIRequestContext } from '@playwright/test'
import { expectApiError, statusOf } from './support/api'
import { createOrg, expect, test } from './support/fixtures'

// Contrôle d'accès tel qu'il existe aujourd'hui (dette Q1.1 de l'audit WS4) :
// - routes « manager » : 401 pour toute session absente OU de mauvais rôle ;
// - routes « RH » : 403 pour toute session absente OU de mauvais rôle.
// Le corps est toujours `{ "error": "Unauthorized" }`. Si la refacto
// harmonise 401/403, c'est ici qu'il faut mettre à jour les attentes.

type Method = 'GET' | 'POST' | 'PUT'

interface Ids {
  employeeNoteId: string
  managerNoteId: string
  employeeId: string
}

interface RouteCase {
  label: string
  method: Method
  path: (ids: Ids) => string
  body?: Record<string, unknown>
}

const EMPLOYEE_ROUTES: RouteCase[] = [
  { label: 'GET /api/expense-notes', method: 'GET', path: () => '/api/expense-notes' },
  { label: 'POST /api/expense-notes', method: 'POST', path: () => '/api/expense-notes' },
  {
    label: 'GET /api/expense-notes/:id/receipt-url',
    method: 'GET',
    path: (ids) => `/api/expense-notes/${ids.employeeNoteId}/receipt-url`,
  },
  {
    label: 'POST /api/expense-notes/receipt-suggestion',
    method: 'POST',
    path: () => '/api/expense-notes/receipt-suggestion',
  },
]

const MANAGER_ROUTES: RouteCase[] = [
  { label: 'GET /api/manager/expense-notes', method: 'GET', path: () => '/api/manager/expense-notes' },
  {
    label: 'POST /api/manager/expense-notes/:id/approve',
    method: 'POST',
    path: (ids) => `/api/manager/expense-notes/${ids.employeeNoteId}/approve`,
  },
  {
    label: 'POST /api/manager/expense-notes/:id/reject',
    method: 'POST',
    path: (ids) => `/api/manager/expense-notes/${ids.employeeNoteId}/reject`,
  },
  {
    label: 'GET /api/manager/expense-notes/:id/receipt-url',
    method: 'GET',
    path: (ids) => `/api/manager/expense-notes/${ids.employeeNoteId}/receipt-url`,
  },
]

const HR_ROUTES: RouteCase[] = [
  { label: 'GET /api/hr/expense-notes', method: 'GET', path: () => '/api/hr/expense-notes' },
  {
    label: 'POST /api/hr/expense-notes/:id/approve',
    method: 'POST',
    path: (ids) => `/api/hr/expense-notes/${ids.managerNoteId}/approve`,
  },
  {
    label: 'POST /api/hr/expense-notes/:id/reject',
    method: 'POST',
    path: (ids) => `/api/hr/expense-notes/${ids.managerNoteId}/reject`,
  },
  {
    label: 'GET /api/hr/expense-notes/:id/receipt-url',
    method: 'GET',
    path: (ids) => `/api/hr/expense-notes/${ids.managerNoteId}/receipt-url`,
  },
  { label: 'GET /api/hr/users', method: 'GET', path: () => '/api/hr/users' },
  {
    label: 'PUT /api/hr/users/:id/manager',
    method: 'PUT',
    path: (ids) => `/api/hr/users/${ids.employeeId}/manager`,
    body: { managerId: null },
  },
]

async function expectRefused(
  request: APIRequestContext,
  routes: RouteCase[],
  ids: Ids,
  status: 401 | 403
): Promise<void> {
  for (const route of routes) {
    const response = await request.fetch(route.path(ids), { method: route.method, data: route.body })
    expect(response.status(), route.label).toBe(status)
    expect(await response.json(), route.label).toMatchObject({ error: 'Unauthorized' })
  }
}

test.describe('Contrôle d’accès par rôle', () => {
  let ids: Ids

  test.beforeEach(async ({ org, apiAs }) => {
    ids = {
      employeeNoteId: (await (await apiAs(org.employee)).submitNote()).id,
      managerNoteId: (await (await apiAs(org.manager)).submitNote()).id,
      employeeId: org.employee.id,
    }
  })

  test.afterEach(async ({ org, apiAs }) => {
    // Aucun refus ne doit avoir d'effet de bord.
    expect(await statusOf(await apiAs(org.employee), ids.employeeNoteId)).toBe('pending')
    expect(await statusOf(await apiAs(org.manager), ids.managerNoteId)).toBe('pending')
    const users = await (await apiAs(org.hr)).hrUsers()
    expect(users.find((user) => user.id === org.employee.id)?.managerId).toBe(org.manager.id)
  })

  test('[ACL-01] sans session : 401 sur les routes employé et manager, 403 sur les routes RH', async ({
    request,
  }) => {
    await expectRefused(request, [...EMPLOYEE_ROUTES, ...MANAGER_ROUTES], ids, 401)
    await expectRefused(request, HR_ROUTES, ids, 403)
  })

  test('[ACL-02] employé : 401 sur les routes manager, 403 sur les routes RH', async ({ org, apiAs }) => {
    const { request } = await apiAs(org.employee)
    await expectRefused(request, MANAGER_ROUTES, ids, 401)
    await expectRefused(request, HR_ROUTES, ids, 403)
  })

  test('[ACL-03] manager : 403 sur les routes RH', async ({ org, apiAs }) => {
    const { request } = await apiAs(org.manager)
    await expectRefused(request, HR_ROUTES, ids, 403)
  })

  test('[ACL-04] RH : 401 sur les routes manager', async ({ org, apiAs }) => {
    const { request } = await apiAs(org.hr)
    await expectRefused(request, MANAGER_ROUTES, ids, 401)
  })
})

test.describe('Isolation entre entreprises', () => {
  test('[ISO-01] la RH d’une autre entreprise ne voit ni ne modifie rien de l’entreprise A', async ({
    org,
    apiAs,
  }) => {
    const otherCompany = await createOrg('iso-01-autre')
    const managerApi = await apiAs(org.manager)
    const managerNote = await managerApi.submitNote({ description: 'Note racine A' })
    const otherHrApi = await apiAs(otherCompany.hr)

    expect((await otherHrApi.hrPending()).map((note) => note.id)).not.toContain(managerNote.id)
    const visibleUsers = (await otherHrApi.hrUsers()).map((user) => user.id)
    expect(visibleUsers).not.toContain(org.employee.id)
    expect(visibleUsers).not.toContain(org.manager.id)
    await expectApiError(await otherHrApi.hrDecide(managerNote.id, 'approve'), 404, 'Not found')
    await expectApiError(await otherHrApi.hrDecide(managerNote.id, 'reject'), 404, 'Not found')
    await expectApiError(await otherHrApi.hrReceiptUrl(managerNote.id), 404, 'Not found')
    await expectApiError(
      await otherHrApi.setManager(org.employee.id, otherCompany.manager.id),
      404,
      'Not found'
    )

    expect(await statusOf(managerApi, managerNote.id)).toBe('pending')
    const users = await (await apiAs(org.hr)).hrUsers()
    expect(users.find((user) => user.id === org.employee.id)?.managerId).toBe(org.manager.id)
  })

  test('[ISO-02] un manager d’une autre entreprise ne voit ni ne tranche les notes de l’entreprise A', async ({
    org,
    apiAs,
  }) => {
    const otherCompany = await createOrg('iso-02-autre')
    const employeeApi = await apiAs(org.employee)
    const note = await employeeApi.submitNote({ description: 'Note employé A' })
    const otherManagerApi = await apiAs(otherCompany.manager)

    expect((await otherManagerApi.managerPending()).map((pending) => pending.id)).not.toContain(note.id)
    await expectApiError(await otherManagerApi.managerDecide(note.id, 'approve'), 404, 'Not found')
    await expectApiError(await otherManagerApi.managerDecide(note.id, 'reject'), 404, 'Not found')
    expect(await statusOf(employeeApi, note.id)).toBe('pending')
  })

  test('[ISO-03] un employé d’une autre entreprise ne voit ni les notes ni les reçus de l’entreprise A', async ({
    org,
    apiAs,
  }) => {
    const otherCompany = await createOrg('iso-03-autre')
    const note = await (await apiAs(org.employee)).submitNote({ description: 'Note employé A' })
    const otherEmployeeApi = await apiAs(otherCompany.employee)

    expect(await otherEmployeeApi.notes()).toEqual([])
    await expectApiError(await otherEmployeeApi.receiptUrl(note.id), 404, 'Not found')
  })
})
