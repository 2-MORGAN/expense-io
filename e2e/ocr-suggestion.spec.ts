import { expectApiError } from './support/api'
import { expect, signIn, test } from './support/fixtures'
import { fixtureImage, pdfReceipt } from './support/files'

// Pré-remplissage depuis le reçu (OCR Tesseract, langue fra). Les images de
// `e2e/fixtures/` sont versionnées : le résultat de l'OCR est déterministe.
//   recu-ocr-complet.png      « Date : 11/10/2026 » + « TOTAL TTC : 42,50 EUR »
//   recu-ocr-montant-seul.png « TOTAL TTC : 12,30 EUR » (pas de date)

test.describe('Pré-remplissage OCR — API', () => {
  test('[OCR-01] ticket lisible → montant et date suggérés', async ({ org, apiAs }) => {
    const response = await (await apiAs(org.employee)).suggest(fixtureImage('recu-ocr-complet.png'))
    expect(response.status()).toBe(200)
    expect(await response.json()).toMatchObject({ amount: 42.5, expenseDate: '2026-10-11' })
  })

  test('[OCR-02] ticket sans date → seul le montant est suggéré', async ({ org, apiAs }) => {
    const response = await (await apiAs(org.employee)).suggest(
      fixtureImage('recu-ocr-montant-seul.png')
    )
    expect(response.status()).toBe(200)
    const suggestion = await response.json()
    expect(suggestion).toMatchObject({ amount: 12.3 })
    expect(suggestion.expenseDate).toBeUndefined()
  })

  test('[OCR-03] PDF (non pris en charge par l’OCR) → 200 et suggestion vide', async ({
    org,
    apiAs,
  }) => {
    const response = await (await apiAs(org.employee)).suggest(pdfReceipt('ocr-03'))
    expect(response.status()).toBe(200)
    const suggestion = await response.json()
    expect(suggestion.amount).toBeUndefined()
    expect(suggestion.expenseDate).toBeUndefined()
  })

  test('[OCR-04] sans fichier → 400 « Champs invalides »', async ({ org, apiAs }) => {
    await expectApiError(await (await apiAs(org.employee)).suggest(), 400, 'Champs invalides')
  })
})

test.describe('Pré-remplissage OCR — interface', () => {
  test('[OCR-05] « Pré-remplir depuis le reçu » remplit montant et date, puis la note se soumet', async ({
    page,
    org,
    apiAs,
  }) => {
    await signIn(page, org.employee)
    await page.goto('/expenses')
    await page.getByLabel('Reçu (image ou PDF)').setInputFiles(fixtureImage('recu-ocr-complet.png'))
    await page.getByRole('button', { name: 'Pré-remplir depuis le reçu' }).click()

    await expect(page.getByLabel('Montant (€)')).toHaveValue('42.5')
    await expect(page.getByLabel('Date')).toHaveValue('2026-10-11')
    await expect(page.getByText(/non reconnu/)).toHaveCount(0)
    await expect(page.getByText(/Aucune information reconnue/)).toHaveCount(0)

    await page.getByLabel('Description').fill('Restaurant le test')
    await page.getByRole('button', { name: 'Soumettre' }).click()
    await expect(page.getByRole('row', { name: /Restaurant le test/ }).getByRole('cell')).toHaveText([
      '11 oct. 2026',
      'Restaurant le test',
      '42,50 €',
      'en attente',
      'Voir le reçu',
    ])
    expect((await (await apiAs(org.employee)).notes())[0]).toMatchObject({
      amount: 42.5,
      expenseDate: '2026-10-11',
    })
  })

  test('[OCR-06] seul le montant est reconnu → montant rempli et avertissement sur la date', async ({
    page,
    org,
  }) => {
    await signIn(page, org.employee)
    await page.goto('/expenses')
    await page
      .getByLabel('Reçu (image ou PDF)')
      .setInputFiles(fixtureImage('recu-ocr-montant-seul.png'))
    await page.getByRole('button', { name: 'Pré-remplir depuis le reçu' }).click()

    await expect(page.getByText('Date non reconnu(e) sur ce reçu — vérifie ce champ.')).toBeVisible()
    await expect(page.getByLabel('Montant (€)')).toHaveValue('12.3')
    await expect(page.getByLabel('Date')).toHaveValue('')
  })

  test('[OCR-07] rien de reconnu (PDF) → invitation à saisir les champs manuellement', async ({
    page,
    org,
  }) => {
    await signIn(page, org.employee)
    await page.goto('/expenses')
    await page.getByLabel('Reçu (image ou PDF)').setInputFiles(pdfReceipt('ocr-07'))
    await page.getByRole('button', { name: 'Pré-remplir depuis le reçu' }).click()

    await expect(
      page.getByText('Aucune information reconnue sur ce reçu — saisis les champs manuellement.')
    ).toBeVisible()
    await expect(page.getByLabel('Montant (€)')).toHaveValue('')
    await expect(page.getByLabel('Date')).toHaveValue('')
  })

  test('[OCR-08] sans reçu sélectionné → « Sélectionne d’abord un reçu. »', async ({ page, org }) => {
    await signIn(page, org.employee)
    await page.goto('/expenses')
    await page.getByRole('button', { name: 'Pré-remplir depuis le reçu' }).click()

    await expect(page.getByRole('main').getByRole('alert')).toHaveText('Sélectionne d’abord un reçu.')
  })
})
