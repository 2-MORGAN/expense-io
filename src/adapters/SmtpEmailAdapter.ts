import nodemailer from 'nodemailer'
import type { EmailMessage, EmailPort } from '@/ports/EmailPort'

export type SmtpConfig = {
  host: string
  port: number
  secure: boolean
  from: string
  auth?: { user: string; pass: string }
}

export interface MailTransport {
  sendMail(mail: EmailMessage & { from: string }): Promise<unknown>
}

// Délais bornés : un serveur SMTP muet ne doit pas bloquer le worker.
const CONNECTION_TIMEOUT_MS = 10_000
const GREETING_TIMEOUT_MS = 10_000
const SOCKET_TIMEOUT_MS = 20_000

export function transportOptions(config: SmtpConfig): {
  host: string
  port: number
  secure: boolean
  auth?: { user: string; pass: string }
  connectionTimeout: number
  greetingTimeout: number
  socketTimeout: number
} {
  return {
    host: config.host,
    port: config.port,
    secure: config.secure,
    ...(config.auth ? { auth: config.auth } : {}),
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    greetingTimeout: GREETING_TIMEOUT_MS,
    socketTimeout: SOCKET_TIMEOUT_MS,
  }
}

export class SmtpEmailAdapter implements EmailPort {
  constructor(
    private readonly transport: MailTransport,
    private readonly from: string
  ) {}

  static fromConfig(config: SmtpConfig): SmtpEmailAdapter {
    return new SmtpEmailAdapter(nodemailer.createTransport(transportOptions(config)), config.from)
  }

  async send(message: EmailMessage): Promise<void> {
    await this.transport.sendMail({ ...message, from: this.from })
  }
}
