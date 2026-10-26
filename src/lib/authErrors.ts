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
