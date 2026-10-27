import { Pool, types, type PoolClient } from 'pg'

// OID 1082 = date. Garde la chaîne "YYYY-MM-DD" brute renvoyée par Postgres
// plutôt qu'un objet Date JS calé sur le fuseau local.
types.setTypeParser(1082, (value: string) => value)

interface PoolTarget {
  connectionString?: string
  applicationName: string
}

declare global {
  var __pgPool: Pool | undefined
  var __pgPoolTarget: PoolTarget | undefined
}

// Par défaut, la connexion de l'application (`expense_app`, 2-481).
// `application_name` désigne le processus dans `pg_stat_activity` (ISO-11).
const WEB_TARGET: PoolTarget = { applicationName: 'expense-web' }

/**
 * Connexion d'un autre processus que l'application, avant le premier
 * `getPool()` : le worker sous `expense_worker`, les tests E2E sous le rôle
 * propriétaire. Une seule cible par processus.
 */
export function configureDatabase(connectionString: string, applicationName: string): void {
  const current = global.__pgPoolTarget
  if (global.__pgPool && (current?.connectionString !== connectionString || current?.applicationName !== applicationName)) {
    throw new Error('configureDatabase must be called before the first getPool()')
  }
  global.__pgPoolTarget = { connectionString, applicationName }
}

export function getPool(): Pool {
  if (!global.__pgPool) {
    const target = global.__pgPoolTarget ?? WEB_TARGET
    const connectionString = target.connectionString ?? process.env.DATABASE_URL
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set')
    }
    global.__pgPool = new Pool({ connectionString, application_name: target.applicationName, max: 20 })
  }
  return global.__pgPool
}

/** Attributs du rôle de la connexion, pour le contrôle au démarrage (`src/lib/dbRole.ts`). */
export async function currentDatabaseRole(): Promise<{ name: string; superuser: boolean; bypassRls: boolean }> {
  const result = await getPool().query<{ name: string; superuser: boolean; bypass_rls: boolean }>(
    'SELECT rolname AS name, rolsuper AS superuser, rolbypassrls AS bypass_rls FROM pg_roles WHERE rolname = current_user'
  )
  const row = result.rows[0]
  return { name: row.name, superuser: row.superuser, bypassRls: row.bypass_rls }
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
 * Exécute `fn` dans un point de sauvegarde de la transaction du `client` : si
 * elle échoue, ses écritures sont annulées, l'erreur est relancée et la
 * transaction reste utilisable (le worker y enregistre l'échec de l'événement).
 */
export async function withSavepoint<T>(client: PoolClient, fn: () => Promise<T>): Promise<T> {
  await client.query('SAVEPOINT outbox_handler')
  try {
    const result = await fn()
    await client.query('RELEASE SAVEPOINT outbox_handler')
    return result
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT outbox_handler')
    throw error
  }
}

/**
 * Pose le contexte lu par les policies RLS pour la transaction en cours :
 * l'utilisateur, puis son entreprise et son rôle, lus en base depuis sa
 * ligne (visible par la policy de `users` grâce à l'id). Jamais pris du
 * client. Utilisateur inconnu : entreprise et rôle restent vides, les
 * policies ne laissent rien voir.
 */
export async function setUserContext(client: PoolClient, userId: string): Promise<void> {
  await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId])
  await client.query(
    `SELECT set_config('app.current_company_id', coalesce(company_id::text, ''), true),
            set_config('app.current_role', coalesce(role, ''), true)
     FROM (SELECT NULL) AS none
     LEFT JOIN users ON users.id = $1`,
    [userId]
  )
}

/**
 * Pose le contexte utilisateur pour la durée de la transaction — l'isolation
 * entre utilisateurs et entre entreprises est garantie par PostgreSQL (Row
 * Level Security, voir migrations/), ce helper ne fait qu'exposer
 * l'utilisateur courant, son entreprise et son rôle aux policies.
 */
export async function withUserScope<T>(
  userId: string,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  return withSystemTransaction(async (client) => {
    await setUserContext(client, userId)
    return fn(client)
  })
}
