import { defineConfig, devices } from '@playwright/test'
import { BASE_URL } from './e2e/support/env'

// Tests E2E de non-régression — voir docs/tests/E2E.md.
//
// Prérequis : Postgres + LocalStack + Mailpit démarrés, migrations appliquées,
// bucket créé (`make up migrate ensure-bucket`). Le serveur Next est démarré par
// Playwright (`npm run dev`), ou réutilisé s'il tourne déjà (`make dev`).
// `E2E_BASE_URL` cible un serveur déjà lancé (ex. build de prod) sans en
// démarrer un.

// Optionnel : chemin d'un Chromium déjà installé (CI, poste sans accès au
// téléchargement des navigateurs Playwright).
const chromiumExecutablePath = process.env.E2E_CHROMIUM_PATH

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    // Les dates et montants sont formatés en fr-FR par le navigateur ; le
    // fuseau est fixé pour que « 2026-10-01 » s'affiche toujours « 1 oct. 2026 ».
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(chromiumExecutablePath
          ? { launchOptions: { executablePath: chromiumExecutablePath } }
          : {}),
      },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: `${BASE_URL}/login`,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
})
