import {
  test as base,
  expect,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from '@playwright/test'
import { ApiClient, signInWithCredentials } from './api'
import { closeDb, createCompany, createUser, type Company, type Role, type TestUser } from './db'

/**
 * Organisation de référence, recréée pour chaque test (domaine unique) :
 * une RH, un manager racine (sans manager) et un employé rattaché à ce
 * manager. Les tests sont donc indépendants et parallélisables.
 */
export interface Org {
  company: Company
  hr: TestUser
  manager: TestUser
  employee: TestUser
}

export async function createOrg(label = 'org'): Promise<Org> {
  const company = await createCompany(label)
  const hr = await createUser(company, { name: 'Hugo Rh', role: 'hr_admin' })
  const manager = await createUser(company, { name: 'Marie Manager', role: 'manager' })
  const employee = await createUser(company, {
    name: 'Emile Employe',
    role: 'employee',
    managerId: manager.id,
  })
  return { company, hr, manager, employee }
}

export function addUser(
  org: Org,
  input: { name: string; role: Role; managerId?: string | null }
): Promise<TestUser> {
  return createUser(org.company, input)
}

/**
 * Délai d'attente des soumissions des formulaires d'inscription et de
 * connexion : le serveur hache (bcrypt, coût 12) puis vérifie le mot de passe,
 * ce qui peut prendre plusieurs secondes sur une machine chargée.
 */
export const AUTH_TIMEOUT = 30_000

/** Connecte le navigateur de `page` (les cookies sont partagés avec `page.context().request`). */
export async function signIn(page: Page, user: TestUser): Promise<void> {
  await signInWithCredentials(page.context().request, user.email, user.password)
}

interface Fixtures {
  /** Organisation de référence propre au test. */
  org: Org
  /** Client API connecté en tant que `user`. */
  apiAs: (user: TestUser) => Promise<ApiClient>
  /** Nouvel onglet anonyme, dans un contexte navigateur isolé (fermé en fin de test). */
  openPage: () => Promise<Page>
  /** Nouvel onglet, dans un contexte navigateur isolé, connecté en tant que `user`. */
  pageAs: (user: TestUser) => Promise<Page>
}

interface WorkerFixtures {
  /** Ferme le pool PostgreSQL des fixtures à l'arrêt du worker. */
  databasePool: void
}

// NB : le second paramètre des fixtures est nommé `provide` (et non `use`)
// pour ne pas déclencher la règle react-hooks d'eslint-config-next.
export const test = base.extend<Fixtures, WorkerFixtures>({
  databasePool: [
    async ({}, provide) => {
      await provide()
      await closeDb()
    },
    { scope: 'worker', auto: true },
  ],

  org: async ({}, provide, testInfo) => {
    await provide(await createOrg(testInfo.title))
  },

  apiAs: async ({ playwright, baseURL }, provide) => {
    const contexts: APIRequestContext[] = []
    await provide(async (user) => {
      const request = await playwright.request.newContext({ baseURL })
      contexts.push(request)
      await signInWithCredentials(request, user.email, user.password)
      return new ApiClient(request, user)
    })
    await Promise.all(contexts.map((context) => context.dispose()))
  },

  openPage: async ({ browser, baseURL, locale, timezoneId }, provide) => {
    const contexts: BrowserContext[] = []
    await provide(async () => {
      const context = await browser.newContext({ baseURL, locale, timezoneId })
      contexts.push(context)
      return context.newPage()
    })
    await Promise.all(contexts.map((context) => context.close()))
  },

  pageAs: async ({ openPage }, provide) => {
    await provide(async (user) => {
      const page = await openPage()
      await signIn(page, user)
      return page
    })
  },
})

export { expect }
