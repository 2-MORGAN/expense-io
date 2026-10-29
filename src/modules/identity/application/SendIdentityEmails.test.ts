import { describe, expect, it, vi } from 'vitest'
import type { EmailMessage, EmailPort } from '@/ports/EmailPort'
import type { IdentityEmailTokens } from '@/modules/identity/ports/IdentityEmailTokens'
import { SendIdentityEmails } from './SendIdentityEmails'

const generate = () => ({ token: 'jeton-en-clair', hash: 'empreinte' })

function fakes(tokens: Partial<IdentityEmailTokens>) {
  const sent: EmailMessage[] = []
  const email: EmailPort = { send: vi.fn(async (message: EmailMessage) => void sent.push(message)) }
  const store: IdentityEmailTokens = {
    issueInvitationToken: vi.fn(async () => null),
    issueVerificationToken: vi.fn(async () => null),
    ...tokens,
  }
  return { sent, email, store, sender: new SendIdentityEmails(store, email, 'https://app.example', generate) }
}

describe('SendIdentityEmails', () => {
  it('invitation : enregistre l’empreinte, puis envoie le lien avec le jeton en clair', async () => {
    const { sent, store, sender } = fakes({
      issueInvitationToken: vi.fn(async () => ({
        email: 'bob@acme.example',
        companyName: 'acme',
        expiresAt: new Date('2026-11-02T10:00:00Z'),
      })),
    })

    await expect(sender.sendInvitation('inv-1')).resolves.toBe(true)
    expect(store.issueInvitationToken).toHaveBeenCalledWith('inv-1', 'empreinte')
    expect(sent).toHaveLength(1)
    expect(sent[0].to).toBe('bob@acme.example')
    expect(sent[0].text).toContain('https://app.example/signup?invitation=jeton-en-clair')
    expect(sent[0].text).not.toContain('empreinte')
  })

  it('vérification : jeton valable 24 h, lien vers /verify-email', async () => {
    const { sent, store, sender } = fakes({
      issueVerificationToken: vi.fn(async () => ({ email: 'alice@acme.example', name: 'Alice' })),
    })

    await expect(sender.sendVerification('user-1')).resolves.toBe(true)
    expect(store.issueVerificationToken).toHaveBeenCalledWith('user-1', 'empreinte', 24)
    expect(sent[0].text).toContain('https://app.example/verify-email?token=jeton-en-clair')
  })

  it('rien à envoyer (invitation acceptée, compte déjà vérifié) : aucun email, sans erreur', async () => {
    const { email, sender } = fakes({})
    await expect(sender.sendInvitation('inv-1')).resolves.toBe(false)
    await expect(sender.sendVerification('user-1')).resolves.toBe(false)
    expect(email.send).not.toHaveBeenCalled()
  })

  it('un échec d’envoi remonte : le worker annule l’empreinte et relance', async () => {
    const failure = new Error('SMTP indisponible')
    const { email, sender } = fakes({
      issueVerificationToken: vi.fn(async () => ({ email: 'alice@acme.example', name: 'Alice' })),
    })
    vi.mocked(email.send).mockRejectedValueOnce(failure)
    await expect(sender.sendVerification('user-1')).rejects.toBe(failure)
  })
})
