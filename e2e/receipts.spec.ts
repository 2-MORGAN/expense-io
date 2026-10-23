import type { APIRequestContext, Locator, Page } from '@playwright/test'
import {
  downloadReceipt,
  expectApiError,
  expectPresignedUrl,
  UNKNOWN_ID,
} from './support/api'
import { addUser, createOrg, expect, signIn, test } from './support/fixtures'
import { pngReceipt, receiptForType, type UploadFile } from './support/files'

/** Clique sur « Voir le reçu » et renvoie l'URL ouverte dans le nouvel onglet. */
async function openReceiptFrom(page: Page, row: Locator): Promise<string> {
  const popupPromise = page.waitForEvent('popup')
  await row.getByRole('button', { name: 'Voir le reçu' }).click()
  const popup = await popupPromise
  await popup.waitForLoadState()
  const url = popup.url()
  await popup.close()
  return url
}

/** L'URL est pré-signée et sert exactement le fichier envoyé, avec son type. */
async function expectServesReceipt(
  request: APIRequestContext,
  url: string,
  receipt: UploadFile
): Promise<void> {
  expectPresignedUrl(url)
  const download = await downloadReceipt(request, url)
  expect(download.status).toBe(200)
  expect(download.contentType).toBe(receipt.mimeType)
  expect(download.body.equals(receipt.buffer), 'contenu du reçu').toBe(true)
}

test.describe('Consultation des reçus — employé', () => {
  test('[RECU-01] « Voir le reçu » ouvre une URL pré-signée qui sert le fichier envoyé', async ({
    page,
    org,
    apiAs,
  }) => {
    const receipt = pngReceipt('recu-01')
    await (await apiAs(org.employee)).submitNote({ description: 'Hôtel Bordeaux', receipt })

    await signIn(page, org.employee)
    await page.goto('/expenses')
    const url = await openReceiptFrom(page, page.getByRole('row', { name: /Hôtel Bordeaux/ }))
    await expectServesReceipt(page.request, url, receipt)
  })

  test('[RECU-02] GET receipt-url : 200 pour sa note, 404 pour la note d’un autre ou un id inconnu', async ({
    org,
    apiAs,
  }) => {
    const colleague = await addUser(org, {
      name: 'Colin Collegue',
      role: 'employee',
      managerId: org.manager.id,
    })
    const receipt = pngReceipt('recu-02')
    const employeeApi = await apiAs(org.employee)
    const ownNote = await employeeApi.submitNote({ receipt })
    const colleagueNote = await (await apiAs(colleague)).submitNote()
    const managerNote = await (await apiAs(org.manager)).submitNote()

    const response = await employeeApi.receiptUrl(ownNote.id)
    expect(response.status()).toBe(200)
    const { url } = (await response.json()) as { url: string }
    await expectServesReceipt(employeeApi.request, url, receipt)

    for (const otherId of [colleagueNote.id, managerNote.id, UNKNOWN_ID]) {
      await expectApiError(await employeeApi.receiptUrl(otherId), 404, 'Not found')
    }
  })

  for (const [label, mimeType] of [
    ['JPEG', 'image/jpeg'],
    ['WebP', 'image/webp'],
    ['PDF', 'application/pdf'],
  ] as const) {
    test(`[RECU-03] reçu ${label} restitué avec son type (${mimeType})`, async ({ org, apiAs }) => {
      const receipt = receiptForType(`recu-03-${label}`, mimeType)
      const api = await apiAs(org.employee)
      const note = await api.submitNote({ receipt })
      const { url } = (await (await api.receiptUrl(note.id)).json()) as { url: string }
      await expectServesReceipt(api.request, url, receipt)
    })
  }
})

test.describe('Consultation des reçus — manager', () => {
  test('[RECU-04] « Voir le reçu » depuis /manager sert le reçu de la note de l’employé', async ({
    org,
    apiAs,
    pageAs,
  }) => {
    const receipt = pngReceipt('recu-04')
    await (await apiAs(org.employee)).submitNote({ description: 'Péage autoroute', receipt })

    const page = await pageAs(org.manager)
    await page.goto('/manager')
    const url = await openReceiptFrom(page, page.getByRole('row', { name: /Péage autoroute/ }))
    await expectServesReceipt(page.request, url, receipt)
  })

  test('[RECU-05] GET manager receipt-url : 200 pour une note de son équipe, 404 pour un id inconnu', async ({
    org,
    apiAs,
  }) => {
    // L'accès d'un manager au reçu d'une note hors de son équipe (IDOR,
    // dette B2) n'est volontairement PAS figé.
    const receipt = pngReceipt('recu-05')
    const note = await (await apiAs(org.employee)).submitNote({ receipt })
    const managerApi = await apiAs(org.manager)

    const response = await managerApi.managerReceiptUrl(note.id)
    expect(response.status()).toBe(200)
    const { url } = (await response.json()) as { url: string }
    await expectServesReceipt(managerApi.request, url, receipt)

    await expectApiError(await managerApi.managerReceiptUrl(UNKNOWN_ID), 404, 'Not found')
  })
})

test.describe('Consultation des reçus — RH', () => {
  test('[RECU-06] « Voir le reçu » depuis /hr sert le reçu de la note du manager racine', async ({
    org,
    apiAs,
    pageAs,
  }) => {
    const receipt = pngReceipt('recu-06')
    await (await apiAs(org.manager)).submitNote({ description: 'Salon professionnel', receipt })

    const page = await pageAs(org.hr)
    await page.goto('/hr')
    const url = await openReceiptFrom(page, page.getByRole('row', { name: /Salon professionnel/ }))
    await expectServesReceipt(page.request, url, receipt)
  })

  test('[RECU-07] GET hr receipt-url : 200 pour un manager racine de l’entreprise, 404 sinon', async ({
    org,
    apiAs,
  }) => {
    const otherOrg = await createOrg('recu-07-autre')
    const subManager = await addUser(org, {
      name: 'Sacha Sousmanager',
      role: 'manager',
      managerId: org.manager.id,
    })
    const receipt = pngReceipt('recu-07')
    const rootManagerNote = await (await apiAs(org.manager)).submitNote({ receipt })
    const employeeNote = await (await apiAs(org.employee)).submitNote()
    const subManagerNote = await (await apiAs(subManager)).submitNote()
    const otherCompanyNote = await (await apiAs(otherOrg.manager)).submitNote()
    const hrApi = await apiAs(org.hr)

    const response = await hrApi.hrReceiptUrl(rootManagerNote.id)
    expect(response.status()).toBe(200)
    const { url } = (await response.json()) as { url: string }
    await expectServesReceipt(hrApi.request, url, receipt)

    for (const id of [employeeNote.id, subManagerNote.id, otherCompanyNote.id, UNKNOWN_ID]) {
      await expectApiError(await hrApi.hrReceiptUrl(id), 404, 'Not found')
    }
  })
})
