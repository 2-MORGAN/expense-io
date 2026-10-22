import { randomUUID } from 'node:crypto'
import { withWorkerTransaction } from '@/lib/workerDb'
import type { OutboxEvent, OutboxPort } from '@/ports/OutboxPort'

export class PostgresOutboxAdapter implements OutboxPort {
  async claim(types: string[]): Promise<OutboxEvent | null> {
    return withWorkerTransaction(async (client) => {
      const token = randomUUID()
      const result = await client.query<{
        id: string; company_id: string; type: string; payload: unknown; attempts: number; created_at: Date
      }>(
        `UPDATE outbox_events SET attempts = attempts + 1, lease_token = $2,
           next_attempt_at = now() + interval '30 seconds'
         WHERE id = (
           SELECT id FROM outbox_events WHERE status = 'pending' AND type = ANY($1::text[])
             AND next_attempt_at <= now() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
         ) RETURNING id, company_id, type, payload, attempts, created_at`, [types, token]
      )
      const row = result.rows[0]
      return row ? {
        id: row.id, companyId: row.company_id, type: row.type, payload: row.payload,
        attempts: row.attempts, createdAt: row.created_at, leaseToken: token,
      } : null
    })
  }
}
