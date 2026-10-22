import { Pool, types, type PoolClient } from 'pg'

// OID 1082 = date. Garde la chaîne "YYYY-MM-DD" brute renvoyée par Postgres
// plutôt qu'un objet Date JS calé sur le fuseau local.
types.setTypeParser(1082, (value: string) => value)

declare global {
  var __pgPool: Pool | undefined
}

export function getPool(): Pool {
  if (!global.__pgPool) {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set')
    }
    global.__pgPool = new Pool({ connectionString, max: 20 })
  }
  return global.__pgPool
}

/**
 * Ferme le pool et l'oublie : le prochain `getPool()` en ouvre un nouveau.
 * Pour les processus qui doivent se terminer proprement (worker, tests).
 */
export async function closePool(): Promise<void> {
  const pool = global.__pgPool
  global.__pgPool = undefined
  await pool?.end()
}

/**
 * Transaction sans contexte utilisateur : réservée aux traitements hors
 * requête (worker, ADR-003). Une route ou un cas d'usage appelé par un
 * utilisateur passe par `withUserScope`.
 */
export async function withSystemTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const pool = getPool()
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

/**
 * Pose le contexte utilisateur pour la durée de la transaction — l'isolation
 * entre utilisateurs et entre entreprises est garantie par PostgreSQL (Row
 * Level Security, voir migrations/), ce helper ne fait qu'exposer l'id
 * courant aux policies.
 */
export async function withUserScope<T>(
  userId: string,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  return withSystemTransaction(async (client) => {
    await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId])
    return fn(client)
  })
}
