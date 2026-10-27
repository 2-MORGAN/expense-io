import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { expect, signIn, test } from './support/fixtures'
import { fixtureImage, oversizedPng } from './support/files'
import { createOrg } from './support/fixtures'
import { db } from './support/db'
import { S3_BUCKET, S3_CONFIG } from './support/env'
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3'

test('[OCR-09] oversized receipt is refused by both endpoints', async ({ org, apiAs }) => {
  const api = await apiAs(org.employee)
  for (const path of ['/api/expense-notes/receipt-suggestion', '/api/receipt-analyses']) {
    const response = await api.request.post(path, { multipart: { receipt: oversizedPng() } })
    expect(response.status()).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'RECEIPT_TOO_LARGE', error: 'Fichier trop volumineux' })
  }
})

test('[OCR-10] highly compressed image above 40 MP is refused', async ({ org, apiAs }) => {
  const image = await sharp({ create: { width: 8000, height: 6000, channels: 3, background: 'white' } }).png().toBuffer()
  const api = await apiAs(org.employee)
  const response = await api.request.post('/api/receipt-analyses', {
    multipart: { receipt: { name: 'large.png', mimeType: 'image/png', buffer: image } },
  })
  expect(response.status()).toBe(400)
  expect(await response.json()).toMatchObject({ code: 'IMAGE_TOO_LARGE' })
})

test('[OCR-11] launch returns 202 and polling retrieves the result', async ({ org, apiAs }) => {
  const api = await apiAs(org.employee)
  const response = await api.request.post('/api/receipt-analyses', {
    multipart: { receipt: fixtureImage('recu-ocr-complet.png') },
  })
  expect(response.status()).toBe(202)
  const accepted = await response.json()
  expect(response.headers().location).toBe(`/api/receipt-analyses/${accepted.id}`)
  await expect.poll(async () => {
    const status = await api.request.get(response.headers().location)
    expect(status.status()).toBe(200)
    return status.json()
  }, { timeout: 10_000 }).toMatchObject({ status: 'succeeded', result: { amount: 42.5, expenseDate: '2026-10-11' } })
})

test('[OCR-12] another user, even from the same company, cannot read an analysis', async ({ org, apiAs }) => {
  const api = await apiAs(org.employee)
  const response = await api.request.post('/api/receipt-analyses', { multipart: { receipt: fixtureImage('recu-ocr-complet.png') } })
  expect(response.status()).toBe(202)
  const location = response.headers().location
  const foreign = await createOrg('foreign-ocr')
  for (const user of [org.manager, foreign.employee]) {
    const other = await apiAs(user)
    const hidden = await other.request.get(location)
    const missing = await other.request.get(`/api/receipt-analyses/${randomUUID()}`)
    expect(hidden.status()).toBe(404)
    expect(missing.status()).toBe(404)
    expect(await hidden.json()).toMatchObject({ code: 'RESOURCE_NOT_FOUND', detail: 'Resource not found.' })
  }
})

test('[OCR-13] concurrent replays create one analysis and reject a different receipt', async ({ org, apiAs }) => {
  const api = await apiAs(org.employee)
  const headers = { 'Idempotency-Key': randomUUID() }
  const responses = await Promise.all([1, 2].map(() => api.request.post('/api/receipt-analyses', {
    headers, multipart: { receipt: fixtureImage('recu-ocr-complet.png') },
  })))
  const analyses = await Promise.all(responses.map(async (response) => {
    expect(response.status()).toBe(202)
    return response.json()
  }))
  expect(analyses[0].id).toBe(analyses[1].id)
  const conflict = await api.request.post('/api/receipt-analyses', {
    headers, multipart: { receipt: fixtureImage('recu-ocr-montant-seul.png') },
  })
  expect(conflict.status()).toBe(422)
})

test('[OCR-14] failed launch releases the interface loading state', async ({ page, org }) => {
  await signIn(page, org.employee)
  await page.goto('/expenses')
  await page.getByLabel('Reçu (image ou PDF)').setInputFiles(fixtureImage('recu-ocr-complet.png'))
  await page.route('**/api/receipt-analyses', (route) => route.abort('failed'))
  await page.getByRole('button', { name: 'Pré-remplir depuis le reçu' }).click()
  await expect(page.getByText('Impossible d’analyser ce reçu.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Pré-remplir depuis le reçu' })).toBeEnabled()
})

test('[OCR-15] failed polling also releases the interface loading state', async ({ page, org }) => {
  await signIn(page, org.employee)
  await page.goto('/expenses')
  await page.getByLabel('Reçu (image ou PDF)').setInputFiles(fixtureImage('recu-ocr-complet.png'))
  await page.route('**/api/receipt-analyses/*', (route) => route.fulfill({ status: 503, body: '{}' }))
  await page.getByRole('button', { name: 'Pré-remplir depuis le reçu' }).click()
  await expect(page.getByText('Impossible d’analyser ce reçu.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Pré-remplir depuis le reçu' })).toBeEnabled()
})

test('[OCR-16] asynchronous endpoints require a session', async ({ request }) => {
  expect((await request.post('/api/receipt-analyses')).status()).toBe(401)
  expect((await request.get(`/api/receipt-analyses/${randomUUID()}`)).status()).toBe(401)
})

test('[OCR-20] completed analysis keeps its result after the temporary receipt is deleted', async ({ org, apiAs }) => {
  const api = await apiAs(org.employee)
  const started = await api.request.post('/api/receipt-analyses', { multipart: { receipt: fixtureImage('recu-ocr-complet.png') } })
  expect(started.status()).toBe(202)
  const { id } = await started.json()
  const row = (await db().query('SELECT receipt_key FROM receipt_analyses WHERE id = $1', [id])).rows[0]
  await expect.poll(async () => (await api.request.get(`/api/receipt-analyses/${id}`)).json()).toMatchObject({ status: 'succeeded' })
  const s3 = new S3Client(S3_CONFIG)
  try {
    await expect.poll(async () => {
      try {
        await s3.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: row.receipt_key }))
        return 200
      } catch (error) {
        return (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
      }
    }, { timeout: 15_000 }).toBe(404)
  } finally { s3.destroy() }
  const result = await api.request.get(`/api/receipt-analyses/${id}`)
  expect(await result.json()).toMatchObject({ status: 'succeeded', result: { amount: 42.5 } })
})

test('[OCR-21] an expired replay key can launch a new visible analysis before physical purge', async ({ org, apiAs }) => {
  const api = await apiAs(org.employee)
  const headers = { 'Idempotency-Key': randomUUID() }
  const first = await api.request.post('/api/receipt-analyses', { headers, multipart: { receipt: fixtureImage('recu-ocr-complet.png') } })
  expect(first.status()).toBe(202)
  const old = await first.json()
  await db().query("UPDATE receipt_analyses SET expires_at = now() - interval '1 second' WHERE id = $1", [old.id])
  expect((await api.request.get(`/api/receipt-analyses/${old.id}`)).status()).toBe(404)
  const next = await api.request.post('/api/receipt-analyses', { headers, multipart: { receipt: fixtureImage('recu-ocr-montant-seul.png') } })
  expect(next.status()).toBe(202)
  const accepted = await next.json()
  expect(accepted.id).not.toBe(old.id)
  expect((await api.request.get(`/api/receipt-analyses/${accepted.id}`)).status()).toBe(200)
})
