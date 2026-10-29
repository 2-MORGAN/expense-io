import { setTimeout as delay } from 'node:timers/promises'
import { withUserScope } from '@/lib/db'

// Deux moteurs au total : routes historiques et workers partagent ces verrous.
// Un crash libère automatiquement les verrous transactionnels.
export function withOcrExecution<T>(userId: string, signal: AbortSignal, task: () => Promise<T>): Promise<T> {
  return withUserScope(userId, async (client) => {
    while (true) {
      signal.throwIfAborted()
      const first = await client.query<{ acquired: boolean }>('SELECT pg_try_advisory_xact_lock(247501, 0) AS acquired')
      if (first.rows[0].acquired) break
      const second = await client.query<{ acquired: boolean }>('SELECT pg_try_advisory_xact_lock(247501, 1) AS acquired')
      if (second.rows[0].acquired) break
      await delay(25, undefined, { signal })
    }
    signal.throwIfAborted()
    return task()
  })
}
