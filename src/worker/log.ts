const MAX_ERROR_LENGTH = 1000

/**
 * Texte d'erreur sûr à écrire dans un log ou dans `last_error` : les adresses
 * email en sont retirées (ADR-005 §5) et la longueur est bornée.
 */
export function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/[^\s<>@]+@[^\s<>@]+/g, '[email]').slice(0, MAX_ERROR_LENGTH)
}

/** Une ligne JSON par message (horodatée en UTC, ISO 8601), lisible par un collecteur de logs. */
export function log(level: 'info' | 'warn' | 'error', msg: string, fields: Record<string, unknown> = {}): void {
  console[level](JSON.stringify({ time: new Date().toISOString(), level, msg, ...fields }))
}
