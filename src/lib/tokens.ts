import { createHash, randomBytes } from 'node:crypto'

/**
 * Jetons des liens d'invitation et de vérification d'email : 32 octets
 * aléatoires, en base64url. Seule l'empreinte SHA-256 est stockée en base ;
 * le jeton en clair n'existe que dans l'email envoyé.
 */
export function generateToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, hash: hashToken(token) }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
