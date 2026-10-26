export interface NewAccount {
  name: string
  email: string
  passwordHash: string
}

export type AcceptInvitationResult =
  | { userId: string }
  | { failure: 'invalid' | 'email_taken' }

/**
 * Inscription et vérification d'email, avant toute session : chaque méthode
 * passe par une fonction de la base à surface étroite (ADR-001, annexe B).
 */
export interface AccountRegistry {
  /**
   * Un compte à l'adresse prouvée existe (S7). Un compte non vérifié ne
   * compte pas : une inscription ou une invitation acceptée le remplace.
   */
  verifiedAccountExists(email: string): Promise<boolean>
  /**
   * Crée une entreprise et sa RH, non vérifiée, et demande l'email de
   * vérification, atomiquement. `null` si l'email a été pris entre-temps.
   */
  registerCompanyAdmin(
    account: NewAccount & { companyName: string; domain: string }
  ): Promise<string | null>
  acceptInvitation(account: NewAccount & { tokenHash: string }): Promise<AcceptInvitationResult>
  previewInvitation(tokenHash: string): Promise<{ email: string; companyName: string } | null>
  verifyEmail(tokenHash: string): Promise<boolean>
  /**
   * Redemande l'email de vérification du compte non vérifié de cette
   * adresse. Sans effet visible si l'adresse est inconnue ou déjà vérifiée.
   */
  requestVerification(email: string): Promise<void>
}
