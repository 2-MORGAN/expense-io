import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3'
import { Pool } from 'pg'
import { APP_DATABASE_URL, MAILPIT_URL, S3_BUCKET, S3_CONFIG } from './support/env'
import { closeOwner, purgeTenants } from './support/tenant'

// Une fois avant le projet `integration` : vérifie l'infrastructure de
// docker-compose.yml, avec un message qui dit quoi lancer, puis purge les
// entreprises `*.integration.test` d'une exécution précédente.

const PREREQUISITES = 'Lancer `make up migrate ensure-bucket` (ou `docker compose up -d --wait`, `npm run migrate:up`, `npm run ensure-bucket`).'

async function checkDatabase(): Promise<void> {
  // Sous le rôle de l'application : la table existe et les droits sont posés.
  const pool = new Pool({ connectionString: APP_DATABASE_URL, max: 1 })
  try {
    await pool.query('SELECT 1 FROM expense_notes LIMIT 1')
  } catch (error) {
    throw new Error(`[integration] PostgreSQL inaccessible ou non migré (${String(error)}). ${PREREQUISITES}`)
  } finally {
    await pool.end()
  }
}

async function checkBucket(): Promise<void> {
  const s3 = new S3Client(S3_CONFIG)
  try {
    await s3.send(new HeadBucketCommand({ Bucket: S3_BUCKET }))
  } catch (error) {
    throw new Error(`[integration] Bucket S3 "${S3_BUCKET}" inaccessible (${String(error)}). ${PREREQUISITES}`)
  } finally {
    s3.destroy()
  }
}

async function checkMailpit(): Promise<void> {
  try {
    const response = await fetch(`${MAILPIT_URL}/api/v1/info`, { signal: AbortSignal.timeout(5_000) })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
  } catch (error) {
    throw new Error(`[integration] Mailpit inaccessible (${String(error)}). ${PREREQUISITES}`)
  }
}

export default async function setup(): Promise<void> {
  try {
    await checkDatabase()
    await checkBucket()
    await checkMailpit()
    const purged = await purgeTenants()
    if (purged > 0) console.log(`[integration] ${purged} entreprise(s) d'une exécution précédente supprimée(s).`)
  } finally {
    await closeOwner()
  }
}
