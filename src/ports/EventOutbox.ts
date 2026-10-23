export type OutboxEventInput = { type: string; payload: Record<string, unknown> }

export interface EventOutbox {
  /** Publie l'événement dans la transaction de l'appelant ; renvoie l'id généré. */
  enqueue(event: OutboxEventInput): Promise<string>
}
