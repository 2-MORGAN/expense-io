export interface EmailMessage {
  to: string
  subject: string
  text: string
  messageId?: string
}

export interface EmailPort {
  send(message: EmailMessage): Promise<void>
}
