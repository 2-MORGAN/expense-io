import { describe, expect, it, vi } from 'vitest'
import type { AccountRegistry } from '@/modules/identity/ports/AccountRegistry'
import { SignUp } from './SignUp'

function registry(overrides: Partial<AccountRegistry> = {}): AccountRegistry {
  return {
    verifiedAccountExists: vi.fn(async () => false),
    registerCompanyAdmin: vi.fn(async () => 'user-1'),
    acceptInvitation: vi.fn(async () => ({ userId: 'user-2' })),
    previewInvitation: vi.fn(async () => null),
    verifyEmail: vi.fn(async () => false),
    requestVerification: vi.fn(async () => undefined),
    ...overrides,
  }
}

const hashPassword = async (password: string) => `bcrypt(${password})`
const hashToken = (token: string) => `sha256(${token})`
const valid = { name: '  Alice  ', email: 'alice@Acme.example', password: 'motdepasse' }

describe('SignUp', () => {
  it('sans invitation : crée une nouvelle entreprise et sa RH, nommée d’après le domaine, à vérifier', async () => {
    const accounts = registry()
    await expect(new SignUp(accounts, hashPassword, hashToken).execute(valid)).resolves.toEqual({
      kind: 'verification_sent',
    })
    expect(accounts.registerCompanyAdmin).toHaveBeenCalledWith({
      name: 'Alice',
      email: 'alice@Acme.example',
      passwordHash: 'bcrypt(motdepasse)',
      companyName: 'acme',
      domain: 'acme.example',
    })
    expect(accounts.acceptInvitation).not.toHaveBeenCalled()
  })

  it('avec une invitation : rejoint l’entreprise de la RH, connexion immédiate', async () => {
    const accounts = registry()
    await expect(
      new SignUp(accounts, hashPassword, hashToken).execute({ ...valid, invitation: 'tok' })
    ).resolves.toEqual({ kind: 'joined', email: 'alice@Acme.example', password: 'motdepasse' })
    expect(accounts.acceptInvitation).toHaveBeenCalledWith({
      name: 'Alice',
      email: 'alice@Acme.example',
      passwordHash: 'bcrypt(motdepasse)',
      tokenHash: 'sha256(tok)',
    })
    expect(accounts.registerCompanyAdmin).not.toHaveBeenCalled()
  })

  it('invitation refusée par la base (expirée, utilisée, autre adresse) → invitation_invalid', async () => {
    const accounts = registry({ acceptInvitation: vi.fn(async () => ({ failure: 'invalid' as const })) })
    await expect(
      new SignUp(accounts, hashPassword, hashToken).execute({ ...valid, invitation: 'tok' })
    ).resolves.toEqual({ kind: 'invitation_invalid' })
  })

  it('email déjà pris, avant ou pendant l’inscription → email_taken', async () => {
    await expect(
      new SignUp(registry({ verifiedAccountExists: vi.fn(async () => true) }), hashPassword, hashToken).execute(valid)
    ).resolves.toEqual({ kind: 'email_taken' })
    await expect(
      new SignUp(registry({ registerCompanyAdmin: vi.fn(async () => null) }), hashPassword, hashToken).execute(valid)
    ).resolves.toEqual({ kind: 'email_taken' })
  })

  it('refuse un nom vide, un email invalide ou un mot de passe trop court', async () => {
    const accounts = registry()
    const signUp = new SignUp(accounts, hashPassword, hashToken)
    for (const input of [
      { ...valid, name: '   ' },
      { ...valid, email: 'alice@localhost' },
      { ...valid, password: 'court' },
      { ...valid, password: null },
    ]) {
      await expect(signUp.execute(input)).resolves.toEqual({ kind: 'invalid' })
    }
    expect(accounts.verifiedAccountExists).not.toHaveBeenCalled()
  })

  it('aperçu d’invitation et vérification d’email passent par l’empreinte du jeton', async () => {
    const accounts = registry({ verifyEmail: vi.fn(async () => true) })
    const signUp = new SignUp(accounts, hashPassword, hashToken)
    await signUp.previewInvitation('tok')
    await expect(signUp.verifyEmail('tok')).resolves.toBe(true)
    expect(accounts.previewInvitation).toHaveBeenCalledWith('sha256(tok)')
    expect(accounts.verifyEmail).toHaveBeenCalledWith('sha256(tok)')
  })

  it('renvoi de vérification : demande l’email pour l’adresse, même réponse qu’elle ait un compte ou non', async () => {
    const accounts = registry()
    const signUp = new SignUp(accounts, hashPassword, hashToken)
    await expect(signUp.resendVerification('  alice@Acme.example ')).resolves.toBe('requested')
    expect(accounts.requestVerification).toHaveBeenCalledWith('alice@Acme.example')
  })

  it('renvoi de vérification : une adresse mal formée n’interroge pas la base', async () => {
    const accounts = registry()
    const signUp = new SignUp(accounts, hashPassword, hashToken)
    for (const email of ['', 'alice@localhost', null, 42]) {
      await expect(signUp.resendVerification(email)).resolves.toBe('invalid')
    }
    expect(accounts.requestVerification).not.toHaveBeenCalled()
  })
})
