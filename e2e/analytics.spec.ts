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
