import type { FailureUpdate } from '@/lib/outbox'

/** Délai avant chaque relance : 1 min, 5 min, 30 min, 2 h, 12 h (ADR-003 §5). */
export const BACKOFF_SECONDS: readonly number[] = [60, 300, 1800, 7200, 43200]

/**
 * `attempts` est le nombre d'essais déjà faits, l'échec qui vient d'arriver
 * compris. Premier essai + `maxRetries` relances : au-delà, l'événement est
 * mort (DLQ). Au-delà de cinq relances, le délai reste de 12 h.
 */
export function nextAttemptAfterFailure(attempts: number, maxRetries: number): FailureUpdate {
  if (attempts > maxRetries) return { status: 'dead' }
  return {
    status: 'pending',
    delaySeconds: BACKOFF_SECONDS[Math.min(attempts, BACKOFF_SECONDS.length) - 1],
  }
}
