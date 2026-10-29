import { cache } from 'react'
import type { UserRole } from '@/modules/identity/domain/User'
import { withUserScope } from '@/lib/db'

/**
 * Rôle courant de l'utilisateur d'une session, relu en base à chaque appel
 * de `auth()` (S9, ADR-001 §4) : un rôle changé s'applique à la requête
 * suivante, un compte supprimé rend `null`. Sous le contexte de
 * l'utilisateur, la policy de `users` laisse lire sa propre ligne.
 * `cache()` partage la lecture entre layout et page d'un même rendu ; hors
 * rendu (proxy, route handlers), chaque appel relit.
 */
export const loadSessionUser = cache(async (userId: string): Promise<{ role: UserRole } | null> => {
  return withUserScope(userId, async (client) => {
    const result = await client.query<{ role: UserRole }>('SELECT role FROM users WHERE id = $1', [userId])
    return result.rows[0] ?? null
  })
})
