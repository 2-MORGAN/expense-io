import { companyNameFromDomain, parseEmail } from '@/domain/identity/identity'
import type { AccountRegistry } from '@/ports/AccountRegistry'

export const MIN_PASSWORD_LENGTH = 8

export interface SignUpInput {
  name: unknown
  email: unknown
  password: unknown
  /** Jeton du lien d'invitation, s'il y en a un. */
  invitation?: unknown
}

export type SignUpResult =
  | { kind: 'invalid' }
  | { kind: 'email_taken' }
  | { kind: 'invitation_invalid' }
  /** Nouvelle entreprise : connexion après vérification de l'email. */
  | { kind: 'verification_sent' }
  /** Invitation acceptée : l'email est vérifié, connexion immédiate. */
  | { kind: 'joined'; email: string; password: string }

// Inscription (S7, ADR-001 §3) : le domaine ne donne plus aucun droit. Sans
// invitation, on crée sa propre entreprise et on en devient RH ; avec une
// invitation valide, on rejoint l'entreprise de la RH qui l'a envoyée.
export class SignUp {
  constructor(
    private readonly registry: AccountRegistry,
    private readonly hashPassword: (password: string) => Promise<string>,
    private readonly hashToken: (token: string) => string
  ) {}

  async execute(input: SignUpInput): Promise<SignUpResult> {
    const parsed = parseEmail(input.email)
    if (
      typeof input.name !== 'string' ||
      input.name.trim().length === 0 ||
      !parsed ||
      typeof input.password !== 'string' ||
      input.password.length < MIN_PASSWORD_LENGTH
    ) {
      return { kind: 'invalid' }
    }

    // Seule une adresse vérifiée est prise : une inscription non confirmée
    // est remplacée par la base (register_user, accept_invitation).
    if (await this.registry.verifiedAccountExists(parsed.email)) {
      return { kind: 'email_taken' }
    }

    const name = input.name.trim()
    const passwordHash = await this.hashPassword(input.password)

    if (typeof input.invitation === 'string' && input.invitation.length > 0) {
      const accepted = await this.registry.acceptInvitation({
        name,
        email: parsed.email,
        passwordHash,
        tokenHash: this.hashToken(input.invitation),
      })
      if ('failure' in accepted) {
        return { kind: accepted.failure === 'email_taken' ? 'email_taken' : 'invitation_invalid' }
      }
      return { kind: 'joined', email: parsed.email, password: input.password }
    }

    const userId = await this.registry.registerCompanyAdmin({
      name,
      email: parsed.email,
      passwordHash,
      companyName: companyNameFromDomain(parsed.domain),
      domain: parsed.domain,
    })
    return userId ? { kind: 'verification_sent' } : { kind: 'email_taken' }
  }

  /** Adresse et entreprise d'une invitation encore utilisable, pour le formulaire. */
  previewInvitation(token: string): Promise<{ email: string; companyName: string } | null> {
    return this.registry.previewInvitation(this.hashToken(token))
  }

  /** Lien de vérification de l'email du créateur : à usage unique. */
  verifyEmail(token: string): Promise<boolean> {
    return this.registry.verifyEmail(this.hashToken(token))
  }

  /**
   * Renvoi de l'email de vérification. La réponse est la même que l'adresse
   * ait un compte non vérifié ou non : elle ne révèle aucune adresse.
   */
  async resendVerification(email: unknown): Promise<'invalid' | 'requested'> {
    const parsed = parseEmail(typeof email === 'string' ? email.trim() : email)
    if (!parsed) return 'invalid'
    await this.registry.requestVerification(parsed.email)
    return 'requested'
  }
}
