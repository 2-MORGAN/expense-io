/**
 * Jetons des emails d'identité, posés par le worker juste avant l'envoi.
 * Chaque méthode enregistre l'empreinte du jeton et rend le destinataire, ou
 * `null` s'il n'y a plus rien à envoyer (invitation acceptée ou expirée,
 * compte déjà vérifié, ligne disparue).
 */
export interface IdentityEmailTokens {
  issueInvitationToken(
    invitationId: string,
    tokenHash: string
  ): Promise<{ email: string; companyName: string; expiresAt: Date } | null>

  issueVerificationToken(
    userId: string,
    tokenHash: string,
    ttlHours: number
  ): Promise<{ email: string; name: string } | null>
}
