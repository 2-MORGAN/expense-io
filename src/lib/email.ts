import { SmtpEmailAdapter, type SmtpConfig } from '@/adapters/SmtpEmailAdapter'
import type { EmailPort } from '@/ports/EmailPort'

export type Env = Readonly<Record<string, string | undefined>>

declare global {
  var __emailSender: EmailPort | undefined
}

const DEFAULT_SMTP_HOST = 'localhost'
const DEFAULT_SMTP_PORT = 1025 // Mailpit de docker-compose
const DEFAULT_FROM = 'Expense.io <no-reply@expense.io>'

export function smtpConfigFromEnv(env: Env): SmtpConfig {
  if (env.NODE_ENV === 'production' && !env.SMTP_HOST) {
    throw new Error('SMTP_HOST is not set')
  }
  const port = Number(env.SMTP_PORT || DEFAULT_SMTP_PORT)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('SMTP_PORT is invalid')
  }
  const config: SmtpConfig = {
    host: env.SMTP_HOST || DEFAULT_SMTP_HOST,
    port,
    secure: env.SMTP_SECURE === 'true',
    from: env.SMTP_FROM || DEFAULT_FROM,
  }
  if (env.SMTP_USER) {
    config.auth = { user: env.SMTP_USER, pass: env.SMTP_PASSWORD ?? '' }
  }
  return config
}

export function createEmailSender(env: Env): EmailPort {
  return SmtpEmailAdapter.fromConfig(smtpConfigFromEnv(env))
}

export function getEmailSender(): EmailPort {
  if (!global.__emailSender) {
    global.__emailSender = createEmailSender(process.env)
  }
  return global.__emailSender
}
