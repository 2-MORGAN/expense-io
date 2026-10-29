export interface InvitationDto {
  id: string
  email: string
  expiresAt: string
}

export interface InvitationRepository {
  /**
   * Crée l'invitation de `email` dans l'entreprise de la RH `actorId`, ou
   * relance celle encore en attente (nouvelle expiration, ancien lien
   * invalidé), et demande l'envoi de l'email dans la même transaction.
   */
  invite(actorId: string, email: string, expiresAt: Date): Promise<InvitationDto>
}
