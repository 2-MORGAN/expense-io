import {
  VERIFICATION_TTL_HOURS,
  invitationEmail,
  invitationUrl,
  verificationEmail,
  verificationUrl,
} from '@/modules/identity/domain/identity'
import type { EmailPort } from '@/ports/EmailPort'
import type { IdentityEmailTokens } from '@/ports/IdentityEmailTokens'

export type TokenGenerator = () => { token: string; hash: string }

// Envoi des emails d'invitation et de vérification par le worker. Le jeton
// est créé ici, au moment de l'envoi : l'outbox ne transporte que des ids.
// Un nouvel envoi remplace le jeton précédent, seul le dernier lien est
// valide. Rien à envoyer (invitation acceptée, compte vérifié…) : fin sans
// erreur, l'événement est terminé.
export class SendIdentityEmails {
  constructor(
    private readonly tokens: IdentityEmailTokens,
    private readonly email: EmailPort,
    private readonly appUrl: string,
    private readonly generateToken: TokenGenerator
  ) {}

  async sendInvitation(invitationId: string): Promise<boolean> {
    const { token, hash } = this.generateToken()
    const invitation = await this.tokens.issueInvitationToken(invitationId, hash)
    if (!invitation) return false
    await this.email.send(
      invitationEmail({
        to: invitation.email,
        companyName: invitation.companyName,
        url: invitationUrl(this.appUrl, token),
        expiresAt: invitation.expiresAt,
      })
    )
    return true
  }

  async sendVerification(userId: string): Promise<boolean> {
    const { token, hash } = this.generateToken()
    const user = await this.tokens.issueVerificationToken(userId, hash, VERIFICATION_TTL_HOURS)
    if (!user) return false
    await this.email.send(
      verificationEmail({ to: user.email, name: user.name, url: verificationUrl(this.appUrl, token) })
    )
    return true
  }
}
