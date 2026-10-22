import { EmailNotificationAdapter } from '@/adapters/EmailNotificationAdapter'
import { getEmailSender, type Env } from '@/lib/email'
import { notificationHandlers } from '@/worker/notificationHandlers'
import type { OutboxHandlers } from '@/worker/processNextEvent'

const DEFAULT_APP_URL = 'http://localhost:3000'

/**
 * Registre unique des traitements asynchrones : un type d'événement de
 * l'outbox = un handler. Le worker ne réclame que les types déclarés ici ;
 * les autres restent `pending` (écart 3 à l'ADR-003 : l'ADR ne prévoit pas ce
 * filtre). Les notifications (2-484) y sont branchées ; l'analyse des reçus
 * (2-475) s'y ajoutera.
 */
export function buildHandlers(env: Env): OutboxHandlers {
  const notifier = new EmailNotificationAdapter(getEmailSender(), env.APP_URL || DEFAULT_APP_URL)
  return { ...notificationHandlers(notifier) }
}
