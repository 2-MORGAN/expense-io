import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import type { EventOutbox, OutboxEventInput } from '@/ports/EventOutbox'

/**
 * Publie dans la transaction du `client` reçu (typiquement celui de
 * `withUserScope`) : l'événement n'existe que si la note ou la décision est
 * validée. L'entreprise est celle de l'utilisateur courant ; hors contexte
 * utilisateur la colonne `company_id` reste nulle et l'insertion est refusée.
 * Pas de `RETURNING` : l'application n'a que l'INSERT sur la table (ADR-001),
 * l'id est donc généré ici.
 */
export class PgEventOutbox implements EventOutbox {
  constructor(private readonly client: PoolClient) {}

  async enqueue(event: OutboxEventInput): Promise<string> {
    const id = randomUUID()
    await this.client.query(
      `INSERT INTO outbox_events (id, company_id, type, payload)
       VALUES (
         $1,
         (SELECT company_id FROM users WHERE id = nullif(current_setting('app.current_user_id', true), '')::uuid),
         $2,
         $3
       )`,
      [id, event.type, JSON.stringify(event.payload)]
    )
    return id
  }
}
