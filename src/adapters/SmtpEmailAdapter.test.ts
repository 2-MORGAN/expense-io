import { describe, expect, it, vi } from 'vitest'
import { SmtpEmailAdapter, transportOptions } from '@/adapters/SmtpEmailAdapter'

const FROM = 'Expense.io <no-reply@expense.io>'

describe('SmtpEmailAdapter', () => {
  it('transmet l’email au transport avec l’expéditeur configuré', async () => {
    const sendMail = vi.fn().mockResolvedValue({})
    await new SmtpEmailAdapter({ sendMail }, FROM).send({
      to: 'jane@acme.test', subject: 'Sujet', text: 'Corps', messageId: '<evt-1.u1@expense.io>',
    })
    expect(sendMail).toHaveBeenCalledWith({
      from: FROM, to: 'jane@acme.test', subject: 'Sujet', text: 'Corps', messageId: '<evt-1.u1@expense.io>',
    })
  })
  it('ne laisse pas un champ `from` du message écraser l’expéditeur configuré', async () => {
    const sendMail = vi.fn().mockResolvedValue({})
    const forged = { to: 'jane@acme.test', subject: 'Sujet', text: 'Corps', from: 'pirate@evil.test' }
    await new SmtpEmailAdapter({ sendMail }, FROM).send(forged)
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ from: FROM }))
  })
  it('propage l’échec du transport (le worker relancera)', async () => {
    const sendMail = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:1025'))
    await expect(new SmtpEmailAdapter({ sendMail }, FROM).send({ to: 'a@b.test', subject: 's', text: 't' }))
      .rejects.toThrow('ECONNREFUSED')
  })
  it('borne les délais SMTP pour qu’un serveur muet ne bloque pas le worker', () => {
    expect(transportOptions({ host: 'localhost', port: 1025, secure: false, from: FROM })).toEqual({
      host: 'localhost', port: 1025, secure: false,
      connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
    })
  })
})
