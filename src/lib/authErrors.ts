// La classe que `next-auth` réexporte, prise à sa source : `auth.ts` reste
// chargeable quand un test remplace `next-auth` par un mock.
import { CredentialsSignin } from '@auth/core/errors'

/** Code de l'échec de connexion d'un compte dont l'email n'est pas encore confirmé (S7). */
export const EMAIL_NOT_VERIFIED = 'email_not_verified'

/**
 * Levée par `authorize()` seulement après un mot de passe correct : elle ne
 * révèle rien de plus qu'une connexion réussie.
 */
export class EmailNotVerified extends CredentialsSignin {
  code = EMAIL_NOT_VERIFIED
}

/** Code de l'échec de connexion refusé par la limite de tentatives (AUTH-11). */
export const TOO_MANY_ATTEMPTS = 'too_many_attempts'

/** Levée par `authorize()` avant toute vérification du mot de passe (ADR-001 §4 point 3). */
export class TooManyLoginAttempts extends CredentialsSignin {
  code = TOO_MANY_ATTEMPTS
}
