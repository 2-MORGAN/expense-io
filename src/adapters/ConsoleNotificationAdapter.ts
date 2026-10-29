import type { NoteDecision } from '@/modules/expenses/domain/Notification'
import type { NotificationPort, Recipient } from '@/ports/NotificationPort'

// Identifiants seulement : jamais d'adresse email dans les logs (ADR-005 §5).
export class ConsoleNotificationAdapter implements NotificationPort {
  async notifySubmitted(
    recipients: Recipient[],
    note: { id: string; description: string; submitterName: string },
    dedupKey: string
  ): Promise<void> {
    const ids = recipients.map((recipient) => recipient.id).join(',')
    console.log(`[notification] submitted note=${note.id} recipients=${ids} key=${dedupKey}`)
  }

  async notifyDecision(
    recipient: Recipient,
    note: { id: string; description: string },
    decision: NoteDecision,
    dedupKey: string
  ): Promise<void> {
    console.log(
      `[notification] decided note=${note.id} recipient=${recipient.id} decision=${decision} key=${dedupKey}`
    )
  }
}
