import { EmailNotificationAdapter } from '@/modules/expenses/adapters/EmailNotificationAdapter'
import { appUrlFromEnv, createEmailSender, type Env } from '@/lib/email'
import { generateToken } from '@/lib/tokens'
import { identityEmailHandlers } from '@/worker/identityEmails'
import { notificationHandlers } from '@/worker/notificationHandlers'
import { receiptAnalysisHandlers } from '@/worker/receiptAnalysis'
import type { OutboxHandlers } from '@/worker/processNextEvent'

/**
 * Registre unique des traitements asynchrones : un type d'événement de
 * l'outbox = un handler. Le worker ne réclame que les types déclarés ici ;
 * les autres restent `pending` (ADR-003). Y sont branchés l'analyse des
 * reçus (2-475), les emails d'invitation et de vérification (2-496) et les
 * notifications de soumission et de décision (2-484). Lève si la
 * configuration est incomplète en production (`APP_URL`, `SMTP_HOST`) : le
 * worker refuse alors de démarrer.
 */
export function buildHandlers(env: Env): OutboxHandlers {
  const email = createEmailSender(env)
  const appUrl = appUrlFromEnv(env)
  return {
    ...receiptAnalysisHandlers(),
    ...identityEmailHandlers(email, appUrl, generateToken),
    ...notificationHandlers(new EmailNotificationAdapter(email, appUrl)),
  }
}
