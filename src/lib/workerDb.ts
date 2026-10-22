import { Pool, type PoolClient } from 'pg'

// Point d'entrée système de l'outbox : identité distincte de l'utilisateur HTTP.
// En production, WORKER_DATABASE_URL désigne le rôle de service (ADR-003).
let pool: Pool | undefined
function workerPool() {
  return pool ??= new Pool({
    connectionString: process.env.WORKER_DATABASE_URL ?? process.env.DATABASE_URL,
    max: 4, connectionTimeoutMillis: 5000,
  })
}

export async function withWorkerTransaction<T>(task: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await workerPool().connect()
  try {
    await client.query('BEGIN')
    const result = await task(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}

export async function closeWorkerDb() {
  const current = pool
  pool = undefined
  await current?.end()
}
