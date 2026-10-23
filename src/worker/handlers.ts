import { EmailNotificationAdapter } from '@/adapters/EmailNotificationAdapter'
import { createEmailSender, type Env } from '@/lib/email'
import { notificationHandlers } from '@/worker/notificationHandlers'
import type { OutboxHandlers } from '@/worker/processNextEvent'

const DEFAULT_APP_URL = 'http://localhost:3000'

/** URL des liens des emails : obligatoire en production, `localhost` par défaut sinon. */
export function appUrlFromEnv(env: Env): string {
  if (env.APP_URL) return env.APP_URL
  if (env.NODE_ENV === 'production') throw new Error('APP_URL is not set')
  return DEFAULT_APP_URL
}

/**
 * Registre unique des traitements asynchrones : un type d'événement de
 * l'outbox = un handler. Le worker ne réclame que les types déclarés ici ;
 * les autres restent `pending` (écart 3 à l'ADR-003 : l'ADR ne prévoit pas ce
 * filtre). Les notifications (2-484) y sont branchées ; l'analyse des reçus
 * (2-475) s'y ajoutera. Lève si la configuration est incomplète en production
 * (`APP_URL`, `SMTP_HOST`) : le worker refuse alors de démarrer.
 */
export function buildHandlers(env: Env): OutboxHandlers {
  const notifier = new EmailNotificationAdapter(createEmailSender(env), appUrlFromEnv(env))
  return { ...notificationHandlers(notifier) }
}
