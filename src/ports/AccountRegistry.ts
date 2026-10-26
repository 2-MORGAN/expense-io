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
  emailExists(email: string): Promise<boolean>
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
}
