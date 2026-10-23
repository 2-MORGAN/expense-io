import type { Env } from '@/lib/email'
import type { OutboxHandlers } from '@/worker/processNextEvent'

/**
 * Registre unique des traitements asynchrones : un type d'événement de
 * l'outbox = un handler. Le worker ne réclame que les types déclarés ici ;
 * les autres restent `pending` (ADR-003). Vide tant qu'aucun traitement n'est
 * branché : les notifications (2-484) et l'analyse des reçus (2-475) s'y ajoutent.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- `env` servira aux handlers qui s'y ajoutent (SMTP, S3…)
export function buildHandlers(env: Env): OutboxHandlers {
  return {}
}
