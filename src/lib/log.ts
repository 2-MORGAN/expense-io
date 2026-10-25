/**
 * Journal du serveur et du worker (ADR-005 §5) : une ligne JSON par
 * événement, horodatée en UTC, sur la sortie standard (`info`) ou d'erreur
 * (`warn`, `error`). Jamais de mot de passe, jeton, cookie, email, contenu de
 * reçu ni URL pré-signée : `fields` ne porte que des identifiants.
 */

const MAX_ERROR_LENGTH = 1000
const MAX_STACK_LENGTH = 4000
// Lu au-delà de la longueur gardée : une adresse ou une URL coupée par la
// troncature reste masquée.
const REDACTION_MARGIN = 512

// Répétitions bornées : coût linéaire, même sur un message énorme (une saisie
// que PostgreSQL recopie dans son erreur).
// Identifiants d'une URL de connexion (`postgres://user:secret@hôte`).
const URL_CREDENTIALS = /\b([a-z][\w+.-]{0,30}:\/\/)[^\s/@]{1,256}@/gi
// Adresse email. La partie locale exclut « / » : les chemins de paquets d'une
// pile (`node_modules/@aws-sdk/…`) restent lisibles.
const EMAIL = /(?<![\p{L}\p{N}._%+-])[\p{L}\p{N}._%+-]{1,64}@[\p{L}\p{N}-]{1,63}(?:\.[\p{L}\p{N}-]{1,63})+/gu
// Paramètres d'une URL, où figure la signature d'une URL pré-signée.
const URL_QUERY = /(https?:\/\/[^\s?#]{1,2048})\?[^\s#'"<>)]*/g

function redact(text: string, maxLength: number): string {
  return text
    .slice(0, maxLength + REDACTION_MARGIN)
    .replace(URL_CREDENTIALS, '$1[redacted]@')
    .replace(EMAIL, '[email]')
    .replace(URL_QUERY, '$1?[redacted]')
    .slice(0, maxLength)
}

/** Message d'erreur sûr à écrire dans un log ou en base (`last_error`), borné. */
export function describeError(error: unknown): string {
  let message: string
  try {
    // Sans message (`ResponseAborted` d'un client parti), le nom de l'erreur.
    message = error instanceof Error ? String(error.message || error.name) : String(error)
  } catch {
    // `Object.create(null)` n'a pas de représentation textuelle.
    message = 'Unprintable error'
  }
  return redact(message, MAX_ERROR_LENGTH)
}

/** Une ligne JSON par message, lisible par un collecteur de logs. */
export function log(level: 'info' | 'warn' | 'error', msg: string, fields: Record<string, unknown> = {}): void {
  console[level](JSON.stringify({ time: new Date().toISOString(), level, msg, ...fields }))
}

/**
 * Erreur serveur, avec son message et sa pile nettoyés : le client n'en
 * reçoit pas le détail (S6), ce journal sert au diagnostic. Pour une requête
 * HTTP, `fields` porte `requestId`, `method`, `route`, `status`, `userId` et
 * `companyId` quand ils sont connus.
 */
export function logError(msg: string, error: unknown, fields: Record<string, unknown> = {}): void {
  const stack = error instanceof Error && typeof error.stack === 'string' ? error.stack : undefined
  log('error', msg, {
    ...fields,
    error: describeError(error),
    ...(stack ? { stack: redact(stack, MAX_STACK_LENGTH) } : {}),
  })
}
