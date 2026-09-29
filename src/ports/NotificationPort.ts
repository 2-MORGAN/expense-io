export interface NotificationPort {
  notifyDecision(userId: string, noteId: string, decision: 'approved' | 'rejected'): Promise<void>
}
