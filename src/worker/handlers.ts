import { appUrlFromEnv, createEmailSender, type Env } from '@/lib/email'
import { generateToken } from '@/lib/tokens'
import { identityEmailHandlers } from '@/worker/identityEmails'
import { receiptAnalysisHandlers } from '@/worker/receiptAnalysis'
import type { OutboxHandlers } from '@/worker/processNextEvent'

/**
 * Registre unique des traitements asynchrones : un type d'événement de
 * l'outbox = un handler. Le worker ne réclame que les types déclarés ici ;
 * les autres restent `pending` (ADR-003). Y sont branchés l'analyse des
 * reçus (2-475) et les emails d'invitation et de vérification (2-496) ; les
 * notifications de décision (2-484) s'y ajoutent.
 */
export function buildHandlers(env: Env): OutboxHandlers {
  return {
    ...receiptAnalysisHandlers(),
    ...identityEmailHandlers(createEmailSender(env), appUrlFromEnv(env), generateToken),
  }
}
