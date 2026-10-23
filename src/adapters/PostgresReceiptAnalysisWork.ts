import { withSystemTransaction } from '@/lib/db'
import type { OutboxEventRecord } from '@/ports/EventOutbox'
import type {
  AnalysisOutcome,
  AnalysisPayload,
  AnalysisStart,
  ReceiptAnalysisWorkPort,
} from '@/ports/ReceiptAnalysisWorkPort'

/**
 * Transactions sans contexte utilisateur (`withSystemTransaction`) : réservées
 * au worker (ADR-001, point de coordination). Chaque écriture pose l'utilisateur
 * de l'analyse pour la RLS de `receipt_analyses`, et n'a lieu que si la prise
 * en charge de l'événement est toujours la nôtre (même essai, encore en
 * attente) : un consommateur périmé, dont le bail a expiré, n'écrit rien.
 */
export class PostgresReceiptAnalysisWork implements ReceiptAnalysisWorkPort {
  async start(event: OutboxEventRecord, payload: AnalysisPayload): Promise<AnalysisStart> {
    return withSystemTransaction(async (client) => {
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [payload.userId])
      const current = await client.query<{ status: string }>(
        'SELECT status FROM receipt_analyses WHERE id = $1 AND user_id = $2 AND company_id = $3',
        [payload.analysisId, payload.userId, payload.companyId]
      )
      const status = current.rows[0]?.status
      if (status === 'succeeded' || status === 'failed') return { kind: 'done' }

      const result = await client.query<{ mime_type: string }>(
        `UPDATE receipt_analyses SET status = 'running'
         WHERE id = $1 AND user_id = $2 AND company_id = $3 AND receipt_key = $4
           AND status IN ('queued', 'running') AND expires_at > now()
           AND EXISTS (SELECT 1 FROM users WHERE id = $2 AND company_id = $3)
           -- Prise en charge toujours la nôtre : même essai, encore en attente.
           AND EXISTS (SELECT 1 FROM outbox_events WHERE id = $5 AND attempts = $6 AND status = 'pending')
         RETURNING mime_type`,
        [payload.analysisId, payload.userId, payload.companyId, payload.receiptKey, event.id, event.attempts]
      )
      const mimeType = result.rows[0]?.mime_type
      return mimeType ? { kind: 'run', mimeType } : { kind: 'missing' }
    })
  }

  async finish(event: OutboxEventRecord, payload: AnalysisPayload, outcome: AnalysisOutcome): Promise<boolean> {
    return withSystemTransaction(async (client) => {
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [payload.userId])
      const result = await client.query(
        `UPDATE receipt_analyses SET status = $4, result = $7, error_code = $8
         WHERE id = $1 AND user_id = $2 AND company_id = $3 AND status IN ('queued', 'running')
           AND EXISTS (SELECT 1 FROM outbox_events WHERE id = $5 AND attempts = $6 AND status = 'pending')`,
        [
          payload.analysisId,
          payload.userId,
          payload.companyId,
          outcome.status,
          event.id,
          event.attempts,
          outcome.status === 'succeeded' ? JSON.stringify(outcome.result) : null,
          outcome.status === 'failed' ? outcome.errorCode : null,
        ]
      )
      return result.rowCount === 1
    })
  }

  async cleanupCandidates() {
    return withSystemTransaction(async (client) => (await client.query<{
      id: string; receipt_key: string; user_id: string
    }>(`SELECT id, receipt_key, user_id FROM receipt_analyses
        WHERE status IN ('succeeded', 'failed') AND receipt_deleted = false LIMIT 20`)).rows)
  }

  async markDeleted(id: string, userId: string) {
    await withSystemTransaction(async (client) => {
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId])
      await client.query('UPDATE receipt_analyses SET receipt_deleted = true WHERE id = $1 AND user_id = $2', [id, userId])
    })
  }

  async purgeExpired() {
    await withSystemTransaction(async (client) => {
      await client.query(
        `DELETE FROM outbox_events WHERE type = 'receipt.analysis.requested' AND status IN ('sent', 'dead')
         AND payload->>'analysisId' IN (SELECT id::text FROM receipt_analyses WHERE expires_at < now() AND receipt_deleted)`
      )
      await client.query('DELETE FROM receipt_analyses WHERE expires_at < now() AND receipt_deleted')
    })
  }
}
