import type { Instrumentation } from 'next'
import { logError } from '@/lib/log'
import { telemetryEnabled } from '@/lib/telemetry/config'

/**
 * Au démarrage du serveur, côté Node.js et hors `next build` (qui n'a ni
 * secret ni base, CI). Imports dynamiques : `pg` et le SDK n'existent que
 * dans le runtime Node.js.
 *
 * 1. Observabilité (ADR-007) : traces, métriques et journaux OpenTelemetry,
 *    si un collecteur est configuré (`OTEL_EXPORTER_OTLP_ENDPOINT`) ; sinon
 *    le SDK n'est pas chargé. En premier : l'instrumentation de pg doit
 *    précéder son chargement par les contrôles qui suivent.
 * 2. Le secret des sessions doit être utilisable (S5, CONF-01) et la
 *    connexion ne doit ni être superuser ni contourner la RLS (S4, ADR-001
 *    §3 point 7, 2-481). Refus en production, avertissement en développement.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.NEXT_PHASE === 'phase-production-build') return
  if (telemetryEnabled(process.env)) {
    const { startTelemetry } = await import('@/lib/telemetry/sdk')
    startTelemetry('expense-io-web')
  }
  const { checkAuthSecretOrExit } = await import('@/lib/authSecret')
  checkAuthSecretOrExit()
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
