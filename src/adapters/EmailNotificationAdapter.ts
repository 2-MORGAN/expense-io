import type { NoteDecision } from '@/domain/Notification'
import type { EmailPort } from '@/ports/EmailPort'
import type { NotificationPort, Recipient } from '@/ports/NotificationPort'

const DECISION_LABEL: Record<NoteDecision, string> = {
  approved: 'approuvée',
  rejected: 'rejetée',
}

// Un email par destinataire, envoyé l'un après l'autre : le premier échec
// interrompt et remonte, le worker relance l'événement. Le Message-ID est stable
// pour un (événement, destinataire) : il identifie l'email mais les serveurs SMTP
// ne dédoublonnent pas dessus. C'est pourquoi l'outbox écrit un événement par
// destinataire : l'échec d'une adresse ne renvoie pas l'email aux autres.
export class EmailNotificationAdapter implements NotificationPort {
  private readonly appUrl: string

  constructor(
    private readonly email: EmailPort,
    appUrl: string
  ) {
    this.appUrl = appUrl.replace(/\/+$/, '')
  }

  async notifySubmitted(
    recipients: Recipient[],
    note: { id: string; description: string; submitterName: string },
    dedupKey: string
  ): Promise<void> {
    const submitter = note.submitterName === '' ? 'Un membre de votre équipe' : note.submitterName
    for (const recipient of recipients) {
      const path = recipient.role === 'hr_admin' ? '/hr' : '/manager'
      await this.email.send({
        to: recipient.email,
        subject: 'Nouvelle note de frais à valider',
        messageId: messageId(dedupKey, recipient),
        text: `Bonjour,\n\n${submitter} a soumis une note de frais : « ${note.description} ».\n\nPour la consulter : ${this.appUrl}${path}\n`,
      })
    }
  }

  async notifyDecision(
    recipient: Recipient,
    note: { id: string; description: string },
    decision: NoteDecision,
    dedupKey: string
  ): Promise<void> {
    const label = DECISION_LABEL[decision]
    await this.email.send({
      to: recipient.email,
      subject: `Votre note de frais a été ${label}`,
      messageId: messageId(dedupKey, recipient),
      text: `Bonjour,\n\nVotre note de frais « ${note.description} » a été ${label}.\n\nPour la consulter : ${this.appUrl}/expenses\n`,
    })
  }
}

function messageId(dedupKey: string, recipient: Recipient): string {
  return `<${dedupKey}.${recipient.id}@expense.io>`
}
