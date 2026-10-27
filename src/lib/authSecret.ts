import { log, logError } from '@/lib/log'

/** Valeur de `.env.example` : connue de tous, elle permet de forger une session (S5). */
export const EXAMPLE_AUTH_SECRET = 'changeme-generate-a-real-secret-for-non-local-use'

/** 32 caractères : la sortie de `openssl rand -base64 32` en fait 44. */
export const MIN_AUTH_SECRET_LENGTH = 32

export type AuthSecretProblem = 'missing' | 'too_short' | 'example'

/** Ce qui rend le secret de signature des sessions inutilisable, ou `null`. */
export function authSecretProblem(secret: string | undefined): AuthSecretProblem | null {
  if (!secret?.trim()) return 'missing'
  if (secret === EXAMPLE_AUTH_SECRET || secret.startsWith('changeme')) return 'example'
  if (secret.length < MIN_AUTH_SECRET_LENGTH) return 'too_short'
  return null
}

/**
 * Contrôle de `AUTH_SECRET` au démarrage du serveur (S5, ADR-001 §4 point 1,
 * CONF-01) : lève en production si le secret est absent, trop court ou égal à
 * la valeur d'exemple ; en développement, une ligne d'avertissement suffit.
 * Le secret lui-même n'est jamais journalisé.
 */
export function checkAuthSecret(secret = process.env.AUTH_SECRET, nodeEnv = process.env.NODE_ENV): void {
  const problem = authSecretProblem(secret)
  if (!problem) return
  if (nodeEnv === 'production') {
    log('error', 'auth.secret.refused', { problem })
    throw new Error(`AUTH_SECRET is unusable (${problem}): refusing to start`)
  }
  log('warn', 'auth.secret.weak', { problem })
}

/** Variante pour `src/instrumentation.ts`, où une erreur de `register()` ne fait que journaliser. */
export function checkAuthSecretOrExit(): void {
  try {
    checkAuthSecret()
  } catch (error) {
    logError('auth.secret.startup', error)
    process.exit(1)
  }
}
