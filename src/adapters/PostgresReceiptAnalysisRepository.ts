import { withUserScope } from '@/lib/db'
import { OcrError, type OcrErrorCode } from '@/domain/receipt/OcrError'
import type { ExpenseNoteSuggestion } from '@/domain/receipt/parseReceiptText'
import type { AnalysisActor, NewReceiptAnalysis, ReceiptAnalysis, ReceiptAnalysisRepository } from '@/ports/ReceiptAnalysisRepository'

interface Row {
  id: string; status: ReceiptAnalysis['status']; result: ExpenseNoteSuggestion | null
  error_code: OcrErrorCode | null; fingerprint: string
}
const dto = (row: Row): ReceiptAnalysis => ({
  id: row.id, status: row.status,
  ...(row.result ? { result: row.result } : {}),
  ...(row.error_code ? { errorCode: row.error_code } : {}),
})

export class PostgresReceiptAnalysisRepository implements ReceiptAnalysisRepository {
  async actor(userId: string): Promise<AnalysisActor> {
    return withUserScope(userId, async (client) => {
      const result = await client.query<{ company_id: string }>('SELECT company_id FROM users WHERE id = $1', [userId])
      if (!result.rows[0]) throw new OcrError('AUTHENTICATION_REQUIRED')
      return { userId, companyId: result.rows[0].company_id }
    })
  }

  async find(actor: AnalysisActor, id: string): Promise<ReceiptAnalysis | null> {
    return withUserScope(actor.userId, async (client) => {
      const result = await client.query<Row>(
        `SELECT id, status, result, error_code, fingerprint FROM receipt_analyses
         WHERE id = $1 AND user_id = $2 AND company_id = $3 AND expires_at > now()`,
        [id, actor.userId, actor.companyId]
      )
      return result.rows[0] ? dto(result.rows[0]) : null
    })
  }

  async replay(actor: AnalysisActor, key: string, fingerprint: string): Promise<ReceiptAnalysis | null> {
    return withUserScope(actor.userId, async (client) => {
      const result = await client.query<Row>(
        `SELECT id, status, result, error_code, fingerprint FROM receipt_analyses
         WHERE user_id = $1 AND company_id = $2 AND idempotency_key = $3 AND expires_at > now()`,
        [actor.userId, actor.companyId, key]
      )
      const row = result.rows[0]
      if (row && row.fingerprint !== fingerprint) throw new OcrError('IDEMPOTENCY_KEY_REUSED')
      return row ? dto(row) : null
    })
  }

  async enqueue(actor: AnalysisActor, input: NewReceiptAnalysis): Promise<ReceiptAnalysis> {
    return withUserScope(actor.userId, async (client) => {
      // Sérialise le quota global et les replays, y compris avec plusieurs serveurs.
      await client.query('SELECT pg_advisory_xact_lock(247500)')
      // Une ancienne ligne peut rester jusqu'au nettoyage S3. Sa clé publique
      // expire néanmoins à 24 h et ne doit pas bloquer un nouvel envoi.
      await client.query(
        `UPDATE receipt_analyses SET idempotency_key = gen_random_uuid()
         WHERE user_id = $1 AND company_id = $2 AND idempotency_key = $3 AND expires_at <= now()`,
        [actor.userId, actor.companyId, input.idempotencyKey]
      )
      const previous = await client.query<Row>(
        `SELECT id, status, result, error_code, fingerprint FROM receipt_analyses
         WHERE user_id = $1 AND company_id = $2 AND idempotency_key = $3`,
        [actor.userId, actor.companyId, input.idempotencyKey]
      )
      if (previous.rows[0]) {
        if (previous.rows[0].fingerprint !== input.fingerprint) throw new OcrError('IDEMPOTENCY_KEY_REUSED')
        return dto(previous.rows[0])
      }
      // La RLS ne doit pas réduire le décompte aux seuls travaux du demandeur.
      const pending = await client.query<{ count: string }>(
        `SELECT count(*) FROM outbox_events WHERE type = 'receipt.analysis.requested' AND status = 'pending'`
      )
      if (Number(pending.rows[0].count) >= 10) throw new OcrError('OCR_OVERLOADED')
      await client.query(
        `INSERT INTO receipt_analyses (id, user_id, company_id, receipt_key, mime_type, fingerprint, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [input.id, actor.userId, actor.companyId, input.receiptKey, input.mimeType, input.fingerprint, input.idempotencyKey]
      )
      await client.query(
        `INSERT INTO outbox_events (company_id, type, payload) VALUES ($1, 'receipt.analysis.requested', $2)`,
        [actor.companyId, JSON.stringify({ version: 1, analysisId: input.id, userId: actor.userId, companyId: actor.companyId, receiptKey: input.receiptKey })]
      )
      return { id: input.id, status: 'queued' }
    })
  }
}
