import type { Page } from '@playwright/test'
import { expectApiError, expectNoteShape, type NoteInput } from './support/api'
import { addUser, expect, signIn, test } from './support/fixtures'
import { oversizedPng, pdfReceipt, pngReceipt, textFile, type UploadFile } from './support/files'

async function fillExpenseForm(
  page: Page,
  fields: { amount: string; expenseDate: string; description: string; receipt: UploadFile }
): Promise<void> {
  await page.getByLabel('Montant (€)').fill(fields.amount)
  await page.getByLabel('Date').fill(fields.expenseDate)
  await page.getByLabel('Description').fill(fields.description)
  await page.getByLabel('Reçu (image ou PDF)').setInputFiles(fields.receipt)
}

test.describe('Soumission d’une note de frais — interface', () => {
  test('[NDF-01] sans note : invitation à soumettre et historique vide', async ({ page, org }) => {
    await signIn(page, org.employee)
    await page.goto('/expenses')

    await expect(page.getByRole('heading', { name: 'Mes notes de frais' })).toBeVisible()
    await expect(page.getByText('Soumets ta première note de frais ci-dessous.')).toBeVisible()
    await expect(page.getByText('Aucune note de frais pour le moment.')).toBeVisible()
  })

  test('[NDF-02] formulaire avec reçu image → note « en attente » dans l’historique, formulaire vidé', async ({
    page,
    org,
    apiAs,
  }) => {
    await signIn(page, org.employee)
    await page.goto('/expenses')
    await fillExpenseForm(page, {
      amount: '42.5',
      expenseDate: '2026-10-01',
      description: 'Taxi aéroport',
      receipt: pngReceipt('ndf-02'),
    })
    await page.getByRole('button', { name: 'Soumettre' }).click()

    const row = page.getByRole('row', { name: /Taxi aéroport/ })
    await expect(row.getByRole('cell')).toHaveText([
      '1 oct. 2026',
      'Taxi aéroport',
      '42,50 €',
      'en attente',
      'Voir le reçu',
    ])
    await expect(page.getByText('1 note · 42,50 € au total')).toBeVisible()
    await expect(page.getByLabel('Montant (€)')).toHaveValue('')
    await expect(page.getByLabel('Date')).toHaveValue('')
    await expect(page.getByLabel('Description')).toHaveValue('')
    await expect(page.getByLabel('Reçu (image ou PDF)')).toHaveValue('')
    await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0)

    const notes = await (await apiAs(org.employee)).notes()
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatchObject({
      userId: org.employee.id,
      amount: 42.5,
      expenseDate: '2026-10-01',
      description: 'Taxi aéroport',
      status: 'pending',
    })
  })

  test('[NDF-03] reçu PDF accepté via le formulaire', async ({ page, org }) => {
    await signIn(page, org.employee)
    await page.goto('/expenses')
    await fillExpenseForm(page, {
      amount: '120',
      expenseDate: '2026-09-15',
      description: 'Hôtel Lyon',
      receipt: pdfReceipt('ndf-03'),
    })
    await page.getByRole('button', { name: 'Soumettre' }).click()

    await expect(page.getByRole('row', { name: /Hôtel Lyon/ }).getByRole('cell')).toHaveText([
      '15 sept. 2026',
      'Hôtel Lyon',
      '120,00 €',
      'en attente',
      'Voir le reçu',
    ])
  })

  test('[NDF-04] plusieurs notes : plus récente en premier, compteur et total cumulés', async ({
    page,
    org,
    apiAs,
  }) => {
    const api = await apiAs(org.employee)
    await api.submitNote({ description: 'Première note', amount: '10', expenseDate: '2026-09-01' })
    await api.submitNote({ description: 'Deuxième note', amount: '1234.5', expenseDate: '2026-09-02' })

    await signIn(page, org.employee)
    await page.goto('/expenses')
    await expect(page.getByText('2 notes · 1 244,50 € au total')).toBeVisible()
    const rows = page.getByRole('row').filter({ has: page.getByRole('cell') })
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(0)).toContainText('Deuxième note')
    await expect(rows.nth(0)).toContainText('1 234,50 €')
    await expect(rows.nth(1)).toContainText('Première note')
  })

  test('[NDF-05] reçu d’un type non autorisé → message d’erreur affiché, aucune note créée', async ({
    page,
    org,
    apiAs,
  }) => {
    await signIn(page, org.employee)
    await page.goto('/expenses')
    await fillExpenseForm(page, {
      amount: '15',
      expenseDate: '2026-10-01',
      description: 'Reçu texte',
      receipt: textFile(),
    })
    await page.getByRole('button', { name: 'Soumettre' }).click()

    await expect(page.getByRole('main').getByRole('alert')).toHaveText(
      'Type de fichier non autorisé pour le reçu'
    )
    await expect(page.getByText('Aucune note de frais pour le moment.')).toBeVisible()
    expect(await (await apiAs(org.employee)).notes()).toHaveLength(0)
  })
})

test.describe('Soumission d’une note de frais — API', () => {
  test('[NDF-06] POST /api/expense-notes → 201 et note « pending » de l’utilisateur', async ({
    org,
    apiAs,
  }) => {
    const api = await apiAs(org.employee)
    const response = await api.createNote({
      amount: '12.34',
      expenseDate: '2026-09-15',
      description: 'Repas client',
      receipt: pngReceipt('ndf-06'),
    })

    expect(response.status()).toBe(201)
    const note = await response.json()
    expectNoteShape(note)
    expect(note).toMatchObject({
      userId: org.employee.id,
      amount: 12.34,
      expenseDate: '2026-09-15',
      description: 'Repas client',
      status: 'pending',
    })
    expect(await api.notes()).toEqual([note])
  })

  for (const [label, mimeType] of [
    ['PNG', 'image/png'],
    ['JPEG', 'image/jpeg'],
    ['WebP', 'image/webp'],
    ['PDF', 'application/pdf'],
  ] as const) {
    test(`[NDF-07] reçu ${label} (${mimeType}) accepté → 201`, async ({ org, apiAs }) => {
      const api = await apiAs(org.employee)
      const receipt = { ...pngReceipt(`ndf-07-${label}`), mimeType, name: `recu.${label.toLowerCase()}` }
      const response = await api.createNote({
        amount: '9.99',
        expenseDate: '2026-10-01',
        description: `Reçu ${label}`,
        receipt,
      })
      expect(response.status(), await response.text()).toBe(201)
    })
  }

  const validNote: Required<NoteInput> = {
    amount: '25',
    expenseDate: '2026-10-01',
    description: 'Déjeuner',
    receipt: pngReceipt('ndf-08'),
  }
  const invalidCases: Array<[string, NoteInput]> = [
    ['montant absent', { ...validNote, amount: undefined }],
    ['montant nul', { ...validNote, amount: '0' }],
    ['montant négatif', { ...validNote, amount: '-5' }],
    ['montant non numérique', { ...validNote, amount: 'abc' }],
    ['date absente', { ...validNote, expenseDate: undefined }],
    ['description absente', { ...validNote, description: undefined }],
    ['description vide', { ...validNote, description: '   ' }],
    ['reçu absent', { ...validNote, receipt: undefined }],
  ]
  for (const [label, input] of invalidCases) {
    test(`[NDF-08] ${label} → 400 « Champs invalides », rien n’est créé`, async ({ org, apiAs }) => {
      const api = await apiAs(org.employee)
      await expectApiError(await api.createNote(input), 400, 'Champs invalides')
      expect(await api.notes()).toHaveLength(0)
    })
  }

  test('[NDF-09] reçu d’un type non autorisé → 400 « Type de fichier non autorisé pour le reçu »', async ({
    org,
    apiAs,
  }) => {
    const api = await apiAs(org.employee)
    await expectApiError(
      await api.createNote({ ...validNote, receipt: textFile() }),
      400,
      'Type de fichier non autorisé pour le reçu'
    )
    expect(await api.notes()).toHaveLength(0)
  })

  test('[NDF-10] reçu de plus de 10 Mio → 400 « Fichier trop volumineux »', async ({ org, apiAs }) => {
    const api = await apiAs(org.employee)
    await expectApiError(
      await api.createNote({ ...validNote, receipt: oversizedPng() }),
      400,
      'Fichier trop volumineux'
    )
    expect(await api.notes()).toHaveLength(0)
  })

  test('[NDF-11] GET /api/expense-notes : uniquement ses propres notes, plus récentes d’abord', async ({
    org,
    apiAs,
  }) => {
    const colleague = await addUser(org, {
      name: 'Colin Collegue',
      role: 'employee',
      managerId: org.manager.id,
    })
    const employeeApi = await apiAs(org.employee)
    const first = await employeeApi.submitNote({ description: 'Note A' })
    const second = await employeeApi.submitNote({ description: 'Note B' })
    await (await apiAs(colleague)).submitNote({ description: 'Note du collègue' })
    await (await apiAs(org.manager)).submitNote({ description: 'Note du manager' })

    const notes = await employeeApi.notes()
    expect(notes.map((note) => note.id)).toEqual([second.id, first.id])
    for (const note of notes) {
      expectNoteShape(note)
      expect(note.userId).toBe(org.employee.id)
    }
  })

  test('[NDF-12] GET /api/expense-notes?sort=<colonne> <direction> trie la liste', async ({
    org,
    apiAs,
  }) => {
    // Usage légitime du paramètre ; l'injection SQL connue (dette B1) n'est
    // volontairement PAS figée ici.
    const api = await apiAs(org.employee)
    await api.submitNote({ amount: '30', description: 'Trente' })
    await api.submitNote({ amount: '10', description: 'Dix' })
    await api.submitNote({ amount: '20', description: 'Vingt' })

    const ascending = await api.notes({ sort: 'amount ASC' })
    expect(ascending.map((note) => note.amount)).toEqual([10, 20, 30])
    const descending = await api.notes({ sort: 'amount DESC' })
    expect(descending.map((note) => note.amount)).toEqual([30, 20, 10])
  })
})
