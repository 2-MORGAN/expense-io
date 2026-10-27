import { createHash } from 'node:crypto'
import type { APIRequestContext, APIResponse } from '@playwright/test'
import { signInWithCredentials } from './support/api'
import { db } from './support/db'
import { AUTH_TIMEOUT, expect, test } from './support/fixtures'

// Limite de tentatives de connexion (AUTH-11, ADR-001 §4 point 3) : 10 échecs
// par email sur 15 minutes (valeurs par défaut), puis refus jusqu'à la fin de
// la fenêtre ; 429 + Retry-After sur l'appel direct de l'API, message dédié
// sur /login. Chaque test a sa propre organisation, donc ses propres adresses.

const MAX_FAILURES = 10

async function attempt(request: APIRequestContext, email: string, password: string): Promise<APIResponse> {
  const { csrfToken } = (await (await request.get('/api/auth/csrf')).json()) as { csrfToken: string }
  return request.post('/api/auth/callback/credentials', {
    form: { csrfToken, email, password, callbackUrl: '/expenses' },
    maxRedirects: 0,
  })
}

async function fail(request: APIRequestContext, email: string, times = MAX_FAILURES): Promise<void> {
  for (let i = 0; i < times; i++) {
    const response = await attempt(request, email, 'pas-le-bon-mot-de-passe')
    expect(response.status(), `échec n° ${i + 1}`).toBe(302)
    expect(response.headers()['location']).toContain('error=')
  }
}

function emailKey(email: string): string {
  return createHash('sha256').update(`email:${email.trim().toLowerCase()}`).digest('hex')
}

test.describe('Connexion — limite de tentatives (AUTH-11)', () => {
  test('[AUTH-11a] 10 échecs → l’appel suivant de l’API répond 429 + Retry-After, même avec le bon mot de passe', async ({
    request,
    org,
  }) => {
    await fail(request, org.employee.email)

    const response = await attempt(request, org.employee.email, org.employee.password)
    expect(response.status()).toBe(429)
    const retryAfter = Number(response.headers()['retry-after'])
    expect(retryAfter).toBeGreaterThan(0)
    expect(retryAfter).toBeLessThanOrEqual(15 * 60)
    expect(response.headers()['content-type']).toContain('application/problem+json')
    expect(await response.json()).toMatchObject({ status: 429, code: 'TOO_MANY_LOGIN_ATTEMPTS' })
    // Aucune adresse en clair dans la table : seulement son empreinte.
    const stored = await db().query('SELECT failures FROM login_attempts WHERE key = $1', [emailKey(org.employee.email)])
    expect(stored.rows[0]?.failures).toBe(MAX_FAILURES)
  })

  test('[AUTH-11b] /login affiche un message dédié ; un autre compte se connecte normalement', async ({ page, request, org }) => {
    await fail(request, org.employee.email)

    await page.goto('/login')
    await page.getByLabel('Email').fill(org.employee.email)
    await page.getByLabel('Mot de passe').fill(org.employee.password)
    await page.getByRole('button', { name: 'Se connecter' }).click()
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(
      'Trop de tentatives de connexion. Réessayez dans quelques minutes.',
      { timeout: AUTH_TIMEOUT }
    )
    await expect(page).toHaveURL(/\/login$/)

    await signInWithCredentials(page.context().request, org.manager.email, org.manager.password)
  })

  test('[AUTH-11c] fin de la fenêtre : la connexion redevient possible (jamais de blocage définitif)', async ({ request, org }) => {
    await fail(request, org.employee.email)
    expect((await attempt(request, org.employee.email, org.employee.password)).status()).toBe(429)

    await db().query(`UPDATE login_attempts SET window_end = now() - interval '1 second' WHERE key = $1`, [
      emailKey(org.employee.email),
    ])
    await signInWithCredentials(request, org.employee.email, org.employee.password)
  })

  test('[AUTH-11d] un email sans compte est limité de la même façon (pas d’énumération)', async ({ request, org }) => {
    const unknown = `inconnu@${org.company.domain}`
    await fail(request, unknown)
    expect((await attempt(request, unknown, 'peu-importe')).status()).toBe(429)
  })
})
