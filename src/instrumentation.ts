import type { Instrumentation } from 'next'
import { logError } from '@/lib/log'

/**
 * Erreurs captées par Next.js hors des `catch` d'une route : rejet d'une
 * promesse non attendue (Q1.3), server action, rendu serveur, proxy. Le client
 * n'en reçoit aucun détail ; cette ligne du journal sert au diagnostic
 * (ADR-005 §5). Ni en-têtes (cookies) ni chaîne de requête.
 */
export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  logError('request.error', error, {
    method: request.method,
    path: request.path.split('?')[0],
    route: context.routePath,
    routeType: context.routeType,
    // Identifiant de l'erreur que Next.js affiche au client sur une page d'erreur.
    digest: typeof error === 'object' && error !== null && 'digest' in error ? String(error.digest) : undefined,
  })
}
