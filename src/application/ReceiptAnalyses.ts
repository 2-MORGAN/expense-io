import { createHash, randomUUID } from 'node:crypto'
import { OcrError } from '@/domain/receipt/OcrError'
import { validateReceipt, type Receipt } from '@/domain/receipt/Receipt'
import type { AnalysisActor, ReceiptAnalysisRepository } from '@/ports/ReceiptAnalysisRepository'
import type { ReceiptStoragePort } from '@/ports/ReceiptStoragePort'
import { UUID } from '@/domain/receipt/analysisPayload'

export class ReceiptAnalyses {
  constructor(private repository: ReceiptAnalysisRepository, private storage: ReceiptStoragePort) {}

  actor(userId: string) { return this.repository.actor(userId) }

  async launch(actor: AnalysisActor, receipt: Receipt, key: string | null, signal: AbortSignal) {
    validateReceipt(receipt)
    if (key !== null && !UUID.test(key)) throw new OcrError('INVALID_IDEMPOTENCY_KEY')
    const idempotencyKey = key ?? randomUUID()
    const fingerprint = createHash('sha256').update(receipt.mimeType).update('\0').update(receipt.data).digest('hex')
    const previous = await this.repository.replay(actor, idempotencyKey, fingerprint)
    if (previous) return previous
    signal.throwIfAborted()
    const id = randomUUID()
    const receiptKey = `receipts/${actor.companyId}/analyses/${id}`
    try {
      await this.storage.upload(receiptKey, receipt.data, receipt.mimeType, signal)
      signal.throwIfAborted()
      const analysis = await this.repository.enqueue(actor, { id, receiptKey, mimeType: receipt.mimeType, fingerprint, idempotencyKey })
      if (analysis.id !== id) await this.storage.delete(receiptKey).catch(() => {})
      return analysis
    } catch (error) {
      // Un COMMIT peut avoir réussi malgré une perte de son accusé de réception.
      // Ne pas supprimer le reçu d'un travail déjà durablement accepté.
      let accepted
      try { accepted = await this.repository.find(actor, id) }
      catch { throw error } // État indéterminé : conserver l'objet pour réconciliation.
      if (accepted) return accepted
      await this.storage.delete(receiptKey).catch(() => {})
      throw error
    }
  }

  async find(actor: AnalysisActor, id: string) {
    const analysis = await this.repository.find(actor, id)
    if (!analysis) throw new OcrError('RESOURCE_NOT_FOUND')
    return analysis
  }
}
