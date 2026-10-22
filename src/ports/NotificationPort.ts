import type { NoteDecision } from '@/domain/Notification'
import type { UserRole } from '@/domain/User'

export interface Recipient {
  id: string
  email: string
  name: string
  role: UserRole
}

// `dedupKey` identifie l'événement d'origine (id de l'outbox) : avec l'id du
// destinataire, il fixe un identifiant d'email stable d'un essai à l'autre.
export interface NotificationPort {
  notifySubmitted(
    recipients: Recipient[],
    note: { id: string; description: string; submitterName: string },
    dedupKey: string
  ): Promise<void>
  notifyDecision(
    recipient: Recipient,
    note: { id: string; description: string },
    decision: NoteDecision,
    dedupKey: string
  ): Promise<void>
}
