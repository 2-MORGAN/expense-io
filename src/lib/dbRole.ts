import { currentDatabaseRole } from '@/lib/db'
import { describeError, log, logError } from '@/lib/log'

export type DatabaseRoleVerdict = 'ok' | 'warn' | 'refuse'

/**
 * Un rôle superuser ou `BYPASSRLS` contourne la RLS, donc l'isolation entre
 * entreprises (S4, ADR-001 §3 point 7) : refus en production, avertissement
 * en développement (un `.env` antérieur à 2-481, resté sur le propriétaire).
 */
export function databaseRoleVerdict(
  role: { superuser: boolean; bypassRls: boolean },
  nodeEnv: string | undefined
): DatabaseRoleVerdict {
  if (!role.superuser && !role.bypassRls) return 'ok'
  return nodeEnv === 'production' ? 'refuse' : 'warn'
}

/**
 * Contrôle du rôle de la connexion au démarrage d'un processus (`web`,
 * `worker`). Lève en production si le rôle contourne la RLS, ou si la base
 * est injoignable ; en développement, une ligne d'avertissement suffit.
 */
export async function checkDatabaseRole(processName: string, nodeEnv = process.env.NODE_ENV): Promise<void> {
  let role: Awaited<ReturnType<typeof currentDatabaseRole>>
  try {
    role = await currentDatabaseRole()
  } catch (error) {
    if (nodeEnv === 'production') throw error
    log('warn', 'db.role.unchecked', { process: processName, error: describeError(error) })
    return
  }

  const verdict = databaseRoleVerdict(role, nodeEnv)
  if (verdict === 'ok') return
  const fields = { process: processName, role: role.name, superuser: role.superuser, bypassRls: role.bypassRls }
  if (verdict === 'refuse') {
    log('error', 'db.role.refused', fields)
    throw new Error(`Database role ${role.name} bypasses row level security: refusing to start`)
  }
  log('warn', 'db.role.bypasses_rls', fields)
}

/**
 * Variante pour le serveur Next.js (`src/instrumentation.ts`) : une erreur de
 * `register()` y est seulement journalisée et le serveur reste en vie. Le
 * refus arrête donc le processus.
 */
export async function checkDatabaseRoleOrExit(processName: string): Promise<void> {
  try {
    await checkDatabaseRole(processName)
  } catch (error) {
    logError('db.role.startup', error)
    process.exit(1)
  }
}
