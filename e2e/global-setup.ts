import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3'
import { request, type FullConfig } from '@playwright/test'
import { signInWithCredentials, UNKNOWN_ID } from './support/api'
import { closeDb, db, purgeE2eData } from './support/db'
import { BASE_URL, S3_BUCKET, S3_CONFIG } from './support/env'
import { createOrg } from './support/fixtures'

// Routes appelées une fois avant les tests : `next dev` compile chaque route
// à la première requête, ce qui rendrait les premiers tests lents.
const ANONYMOUS_WARMUP: Array<[method: string, path: string]> = [
  ['GET', '/'],
  ['GET', '/login'],
  ['GET', '/signup'],
  ['GET', '/api/auth/session'],
  ['GET', '/api/expense-notes'],
  ['POST', '/api/expense-notes'],
  ['GET', `/api/expense-notes/${UNKNOWN_ID}/receipt-url`],
  ['POST', '/api/expense-notes/receipt-suggestion'],
  ['GET', '/api/manager/expense-notes'],
  ['POST', `/api/manager/expense-notes/${UNKNOWN_ID}/approve`],
  ['POST', `/api/manager/expense-notes/${UNKNOWN_ID}/reject`],
  ['GET', `/api/manager/expense-notes/${UNKNOWN_ID}/receipt-url`],
  ['GET', '/api/hr/expense-notes'],
  ['POST', `/api/hr/expense-notes/${UNKNOWN_ID}/approve`],
  ['POST', `/api/hr/expense-notes/${UNKNOWN_ID}/reject`],
  ['GET', `/api/hr/expense-notes/${UNKNOWN_ID}/receipt-url`],
  ['GET', '/api/hr/users'],
  ['PUT', `/api/hr/users/${UNKNOWN_ID}/manager`],
]

async function checkDatabase(): Promise<void> {
  try {
    await db().query('SELECT 1 FROM users LIMIT 1')
  } catch (error) {
    throw new Error(
      `[e2e] Base PostgreSQL inaccessible ou non migrée (${String(error)}). ` +
        'Lancer `make up migrate` (ou `docker compose up -d && npm run migrate:up`).'
    )
  }
}

async function checkBucket(): Promise<void> {
  const s3 = new S3Client(S3_CONFIG)
  try {
    await s3.send(new HeadBucketCommand({ Bucket: S3_BUCKET }))
  } catch (error) {
    throw new Error(
      `[e2e] Bucket S3 "${S3_BUCKET}" inaccessible (${String(error)}). ` +
        'Lancer `make up ensure-bucket` (ou `npm run ensure-bucket`).'
    )
  } finally {
    s3.destroy()
  }
}

async function warmUp(baseURL: string): Promise<void> {
  const anonymous = await request.newContext({ baseURL })
  for (const [method, path] of ANONYMOUS_WARMUP) {
    await anonymous.fetch(path, { method, timeout: 120_000 })
  }
  await anonymous.dispose()

  // Pages authentifiées (une par rôle).
  const org = await createOrg('warmup')
  for (const [user, path] of [
    [org.employee, '/expenses'],
    [org.manager, '/manager'],
    [org.hr, '/hr'],
  ] as const) {
    const context = await request.newContext({ baseURL })
    await signInWithCredentials(context, user.email, user.password)
    await context.get(path, { timeout: 120_000 })
    await context.dispose()
  }
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  try {
    await checkDatabase()
    await checkBucket()

    try {
      const purged = await purgeE2eData()
      if (purged > 0) {
        console.log(`[e2e] ${purged} entreprise(s) de test d'une exécution précédente supprimée(s).`)
      }
    } catch (error) {
      console.warn('[e2e] Purge des données de test impossible, poursuite quand même :', error)
    }

    try {
      await warmUp(config.projects[0]?.use.baseURL ?? BASE_URL)
    } catch (error) {
      // Simple optimisation : un échec ici sera de toute façon révélé par les tests.
      console.warn('[e2e] Préchauffage du serveur incomplet :', error)
    }
  } finally {
    await closeDb()
  }
}
