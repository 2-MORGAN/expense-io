import { withWorkerTransaction } from '@/lib/workerDb'
import type { OutboxEvent } from '@/ports/OutboxPort'
import { type OcrErrorCode } from '@/domain/receipt/OcrError'
import type { AnalysisPayload, ReceiptAnalysisWorkPort } from '@/ports/ReceiptAnalysisWorkPort'
import { ANALYSIS_QUEUE_TIMEOUT_MS } from '@/domain/receipt/limits'
import type { ExpenseNoteSuggestion } from '@/domain/receipt/parseReceiptText'

export class PostgresReceiptAnalysisWork implements ReceiptAnalysisWorkPort {
  async start(event: OutboxEvent, payload: AnalysisPayload): Promise<string | null> {
    return withWorkerTransaction(async (client) => {
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [payload.userId])
      const result = await client.query<{ mime_type: string }>(
        `UPDATE receipt_analyses SET status = 'running'
         WHERE id = $1 AND user_id = $2 AND company_id = $3 AND receipt_key = $4
           AND status IN ('queued', 'running') AND expires_at > now()
           AND EXISTS (SELECT 1 FROM users WHERE id = $2 AND company_id = $3)
           AND EXISTS (SELECT 1 FROM outbox_events WHERE id = $5 AND lease_token = $6 AND status = 'pending')
         RETURNING mime_type`,
        [payload.analysisId, payload.userId, payload.companyId, payload.receiptKey, event.id, event.leaseToken]
      )
      return result.rows[0]?.mime_type ?? null
    })
  }

  async finish(event: OutboxEvent, payload: AnalysisPayload | null, result?: ExpenseNoteSuggestion, failure?: OcrErrorCode) {
    return withWorkerTransaction(async (client) => {
      const lease = await client.query(
        'SELECT id FROM outbox_events WHERE id = $1 AND lease_token = $2 AND status = $3 FOR UPDATE',
        [event.id, event.leaseToken, 'pending']
      )
      if (lease.rowCount !== 1) return
      const transient = failure === 'OCR_TIMEOUT' || failure === 'OCR_UNAVAILABLE' || failure === 'OCR_OVERLOADED'
      const retry = payload && transient && event.attempts < 3
        && Date.now() - event.createdAt.getTime() < ANALYSIS_QUEUE_TIMEOUT_MS
      if (payload) {
        await client.query("SELECT set_config('app.current_user_id', $1, true)", [payload.userId])
        await client.query(
          `UPDATE receipt_analyses SET status = $4, result = $5, error_code = $6
           WHERE id = $1 AND user_id = $2 AND company_id = $3 AND status IN ('queued', 'running')`,
          [payload.analysisId, payload.userId, payload.companyId,
            retry ? 'queued' : failure ? 'failed' : 'succeeded',
            result ? JSON.stringify(result) : null, retry ? null : failure ?? null]
        )
      }
      await client.query(
        `UPDATE outbox_events SET status = $3, last_error = $4, lease_token = NULL,
           next_attempt_at = now() + ($5 * interval '1 second') WHERE id = $1 AND lease_token = $2`,
        [event.id, event.leaseToken, retry ? 'pending' : failure ? 'dead' : 'sent', failure ?? null,
          event.attempts === 1 ? 1 : 5]
      )
    })
  }

  async cleanupCandidates() {
    return withWorkerTransaction(async (client) => (await client.query<{
      id: string; receipt_key: string; user_id: string
    }>(`SELECT id, receipt_key, user_id FROM receipt_analyses
        WHERE status IN ('succeeded', 'failed') AND receipt_deleted = false LIMIT 20`)).rows)
  }

  async markDeleted(id: string, userId: string) {
    await withWorkerTransaction(async (client) => {
      await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId])
      await client.query('UPDATE receipt_analyses SET receipt_deleted = true WHERE id = $1 AND user_id = $2', [id, userId])
    })
  }

  async purgeExpired() {
    await withWorkerTransaction(async (client) => {
      await client.query(
        `DELETE FROM outbox_events WHERE type = 'receipt.analysis.requested' AND status IN ('sent', 'dead')
         AND payload->>'analysisId' IN (SELECT id::text FROM receipt_analyses WHERE expires_at < now() AND receipt_deleted)`
      )
      await client.query('DELETE FROM receipt_analyses WHERE expires_at < now() AND receipt_deleted')
    })
  }
}
