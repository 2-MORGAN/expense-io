import type { PoolClient } from 'pg'
import {
  EXPENSE_NOTE_DECIDED,
  EXPENSE_NOTE_SUBMITTED,
  isDecidedPayload,
  isSubmittedPayload,
} from '@/domain/Notification'
import { findCompanyRecipients } from '@/lib/notifications'
import type { OutboxEvent } from '@/lib/outbox'
import type { NotificationPort, Recipient } from '@/ports/NotificationPort'
import { log } from '@/worker/log'
import type { OutboxHandlers } from '@/worker/processNextEvent'

// 5 relances après le premier essai : 1 min, 5 min, 30 min, 2 h, 12 h (ADR-003 §5).
const MAX_RETRIES = 5

// Le payload fige les destinataires à l'émission ; on les relit dans l'entreprise
// de l'événement seulement. Un id d'une autre entreprise (bug amont, payload
// forgé) est écarté et n'est signalé que par des nombres : jamais d'adresse
// dans les logs (ADR-005 §5).
async function resolveRecipients(
  client: PoolClient,
  event: OutboxEvent,
  recipientIds: string[]
): Promise<Recipient[]> {
  const requested = [...new Set(recipientIds)]
  const recipients = await findCompanyRecipients(client, event.companyId, requested)
  if (recipients.length < requested.length) {
    log('warn', 'notification.recipients_filtered', {
      eventId: event.id,
      requested: requested.length,
      kept: recipients.length,
    })
  }
  return recipients
}

export function notificationHandlers(notifier: NotificationPort): OutboxHandlers {
  return {
    [EXPENSE_NOTE_SUBMITTED]: {
      maxRetries: MAX_RETRIES,
      async handle(event, client) {
        const payload = event.payload
        if (!isSubmittedPayload(payload)) {
          throw new Error(`invalid payload for ${EXPENSE_NOTE_SUBMITTED}`)
        }
        const recipients = await resolveRecipients(client, event, payload.recipientIds)
        if (recipients.length === 0) return
        await notifier.notifySubmitted(
          recipients,
          { id: payload.noteId, description: payload.description, submitterName: payload.submitterName },
          event.id
        )
      },
    },
    [EXPENSE_NOTE_DECIDED]: {
      maxRetries: MAX_RETRIES,
      async handle(event, client) {
        const payload = event.payload
        if (!isDecidedPayload(payload)) {
          throw new Error(`invalid payload for ${EXPENSE_NOTE_DECIDED}`)
        }
        const recipients = await resolveRecipients(client, event, payload.recipientIds)
        for (const recipient of recipients) {
          await notifier.notifyDecision(
            recipient,
            { id: payload.noteId, description: payload.description },
            payload.decision,
            event.id
          )
        }
      },
    },
  }
}
