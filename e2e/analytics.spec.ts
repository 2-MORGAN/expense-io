import type { Page } from '@playwright/test'
import { UMAMI_BEFORE_SEND, umamiScriptConfig } from '@/components/analytics'
import { expect, test } from './support/fixtures'

// Mesure d'usage (ADR-008) : le script d'Umami n'est chargé que s'il est
// configuré, avec les variables que lit aussi l'application (`.env`, chargé par
// e2e/support/env.ts). En CI, sans elles, aucune page ne le charge.

test('[USAGE-01] Umami : aucun script sans configuration ; configuré, URL envoyées sans chaîne de requête ni fragment', async ({
  page,
}) => {
  await page.goto('/login')
  await page.waitForLoadState('networkidle')
  const script = page.locator('script[data-website-id]')
  const config = umamiScriptConfig(process.env)

  if (!config) {
    await expect(script).toHaveCount(0)
    expect(await page.evaluate(() => 'umami' in window)).toBe(false)
    return
  }
  await expect(script).toHaveAttribute('src', config.src)
  await expect(script).toHaveAttribute('data-website-id', config.websiteId)
  await expect(script).toHaveAttribute('data-exclude-search', 'true')
  await expect(script).toHaveAttribute('data-exclude-hash', 'true')
  await expect(script).toHaveAttribute('data-before-send', UMAMI_BEFORE_SEND)
  const beforeSendType = await page.evaluate(
    (name) => typeof (window as unknown as Record<string, unknown>)[name],
    UMAMI_BEFORE_SEND
  )
  expect(beforeSendType).toBe('function')
})

test('[USAGE-02] Heatmap d’Umami : recorder.js seulement sur les pages de travail avec UMAMI_HEATMAP=true, jamais sur une page à jeton', async ({
  org,
  openPage,
  pageAs,
}) => {
  const config = umamiScriptConfig(process.env)
  const recorder = (page: Page) => page.locator('script[src$="/recorder.js"]')

  const visitor = await openPage()
  await visitor.goto('/signup?invitation=jeton-e2e')
  await visitor.waitForLoadState('networkidle')
  await expect(recorder(visitor)).toHaveCount(0)

  const employee = await pageAs(org.employee)
  await employee.goto('/expenses')
  await employee.waitForLoadState('networkidle')
  if (!config?.recorderSrc) {
    await expect(recorder(employee)).toHaveCount(0)
    return
  }
  await expect(recorder(employee)).toHaveAttribute('src', config.recorderSrc)
  await expect(recorder(employee)).toHaveAttribute('data-website-id', config.websiteId)

  // Quitter les pages mesurées par une navigation côté client recharge la page : le script s'arrête.
  await employee.getByRole('banner').getByRole('button', { name: 'Se déconnecter' }).click()
  await expect(employee).toHaveURL(/\/login$/)
  await expect(recorder(employee)).toHaveCount(0)
})

test('[USAGE-03] Replays d’Umami : chaque page porte rr-mask, aucun texte enregistré quel que soit le réglage d’Umami', async ({
  org,
  page,
  pageAs,
}) => {
  await page.goto('/login')
  await expect(page.locator('body')).toHaveClass(/(^|\s)rr-mask(\s|$)/)

  const employee = await pageAs(org.employee)
  await employee.goto('/expenses')
  await expect(employee.locator('body')).toHaveClass(/(^|\s)rr-mask(\s|$)/)
})
