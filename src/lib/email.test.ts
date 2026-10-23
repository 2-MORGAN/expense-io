import { describe, expect, it } from 'vitest'
import { SmtpEmailAdapter } from '@/adapters/SmtpEmailAdapter'
import { createEmailSender, smtpConfigFromEnv } from '@/lib/email'

describe('smtpConfigFromEnv', () => {
  it('vise le Mailpit de docker-compose par défaut', () => {
    expect(smtpConfigFromEnv({})).toEqual({
      host: 'localhost', port: 1025, secure: false, from: 'Expense.io <no-reply@expense.io>',
    })
  })
  it('lit un fournisseur avec authentification', () => {
    expect(smtpConfigFromEnv({
      SMTP_HOST: 'smtp.example.test', SMTP_PORT: '465', SMTP_SECURE: 'true',
      SMTP_USER: 'apikey', SMTP_PASSWORD: 's3cret', SMTP_FROM: 'Notes <notes@example.test>',
    })).toEqual({
      host: 'smtp.example.test', port: 465, secure: true, from: 'Notes <notes@example.test>',
      auth: { user: 'apikey', pass: 's3cret' },
    })
  })
  it('refuse un port invalide', () => {
    expect(() => smtpConfigFromEnv({ SMTP_PORT: 'abc' })).toThrow('SMTP_PORT')
  })
  it('exige SMTP_HOST en production', () => {
    expect(() => smtpConfigFromEnv({ NODE_ENV: 'production' })).toThrow('SMTP_HOST')
  })
})

describe('createEmailSender', () => {
  it('envoie par SMTP', () => {
    expect(createEmailSender({})).toBeInstanceOf(SmtpEmailAdapter)
  })
})
