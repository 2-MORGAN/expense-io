import { problemResponse } from './problem'
import { requestContext } from './requestContext'
import type { Session } from 'next-auth'
import type { UserRole } from '@/modules/identity/domain/User'

// Vérification commune du rôle pour les routes (WS2) : 401 sans session,
// 403 si le rôle est refusé. Sans `role`, vérifie seulement la session.
// Renvoie l'utilisateur authentifié, ou la réponse d'erreur à retourner.
// Seul point de création : 2-471 et 2-485 ont pour consigne de ne pas en créer.
export function requireRole(session: Session | null, role?: UserRole): Session['user'] | Response {
  if (!session?.user) {
    return problemResponse('AUTHENTICATION_REQUIRED')
  }
  if (role !== undefined && session.user.role !== role) {
    return problemResponse('FORBIDDEN')
  }
  const context = requestContext.getStore()
  if (context) context.userId = session.user.id
  return session.user
}
