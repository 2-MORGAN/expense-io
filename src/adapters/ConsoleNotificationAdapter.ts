import type { NotificationPort } from '@/ports/NotificationPort'

export class ConsoleNotificationAdapter implements NotificationPort {
  async notifyDecision(
    userId: string,
    noteId: string,
    decision: 'approved' | 'rejected'
  ): Promise<void> {
    console.log(`[notification] user=${userId} note=${noteId} decision=${decision}`)
  }
}
