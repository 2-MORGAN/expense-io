import type { Instrumentation } from 'next'
import { logError } from '@/lib/log'

/**
 * Au démarrage du serveur : la connexion ne doit ni être superuser ni
 * contourner la RLS (S4, ADR-001 §3 point 7, 2-481). Refus en production,
 * avertissement en développement. Pas pendant `next build`, qui n'a pas de
 * base (CI). Import dynamique : `pg` n'existe que dans le runtime Node.js.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.NEXT_PHASE === 'phase-production-build') return
  const { checkDatabaseRoleOrExit } = await import('@/lib/dbRole')
  await checkDatabaseRoleOrExit('web')
}

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
