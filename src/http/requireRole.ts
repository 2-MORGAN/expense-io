import type { Session } from 'next-auth'
import type { UserRole } from '@/domain/User'

// Vérification commune du rôle pour les routes (WS2) : 401 sans session,
// 403 si le rôle est refusé. Sans `role`, vérifie seulement la session.
// Renvoie l'utilisateur authentifié, ou la réponse d'erreur à retourner.
// Seul point de création : 2-471 et 2-485 ont pour consigne de ne pas en créer.
export function requireRole(session: Session | null, role?: UserRole): Session['user'] | Response {
  if (!session?.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (role !== undefined && session.user.role !== role) {
    return Response.json({ error: 'Unauthorized' }, { status: 403 })
  }
  return session.user
}
