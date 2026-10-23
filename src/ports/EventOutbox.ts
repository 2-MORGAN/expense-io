export type OutboxEventInput = { type: string; payload: Record<string, unknown> }

export interface EventOutbox {
  /** Publie l'événement dans la transaction de l'appelant ; renvoie l'id généré. */
  enqueue(event: OutboxEventInput): Promise<string>
}

/** Événement de l'outbox tel que le worker le remet à son traitement. */
export interface OutboxEventRecord {
  id: string
  companyId: string
  type: string
  payload: Record<string, unknown>
  /** Numéro de l'essai en cours, déjà compté à la prise en charge. */
  attempts: number
  createdAt: Date
}

/**
 * Échec définitif d'un traitement (payload invalide, ressource disparue,
 * budget épuisé) : l'événement passe `dead` sans attendre ses relances.
 */
export class NonRetryableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NonRetryableError'
  }
}
