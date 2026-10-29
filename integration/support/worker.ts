import { Pool, type PoolClient } from 'pg'
import { configureDatabase } from '@/lib/db'
import { WORKER_DATABASE_URL } from './env'

// Connexion du worker (`expense_worker`) pour ce que seul le worker a le droit
// de faire : poser l'empreinte d'un jeton d'email avant l'envoi (2-481).

/**
 * Le code de src/ testé par ce fichier se connecte comme le worker, au lieu de
 * l'application : à appeler en tête du fichier, avant toute requête.
 */
export function connectAsWorker(): void {
  configureDatabase(WORKER_DATABASE_URL, 'expense-integration-worker')
}

let pool: Pool | undefined

/** Exécute `fn` dans une transaction sous `expense_worker`, validée sauf erreur. */
export async function asWorker<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  pool ??= new Pool({ connectionString: WORKER_DATABASE_URL, max: 2, application_name: 'expense-integration-worker' })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function closeWorker(): Promise<void> {
  await pool?.end()
  pool = undefined
}
