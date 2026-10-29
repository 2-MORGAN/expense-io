import type { Receipt } from '@/modules/receipt-analysis/domain/Receipt'
import type { OcrPort } from '@/modules/receipt-analysis/ports/OcrPort'
import type { OcrExecutionPort } from '@/modules/receipt-analysis/ports/OcrExecutionPort'
import type { ReceiptAnalyses } from './ReceiptAnalyses'
import type { SuggestReceiptFields } from './SuggestReceiptFields'

export class OcrRequests {
  constructor(
    private suggestFields: SuggestReceiptFields,
    private analyses: ReceiptAnalyses,
    private ocr: OcrPort,
    private execution: OcrExecutionPort,
  ) {}

  suggest(userId: string, receipt: Receipt, signal: AbortSignal) {
    return this.execution.run(userId, signal, () => this.suggestFields.execute(receipt, signal))
  }

  async launch(userId: string, receipt: Receipt, key: string | null, signal: AbortSignal) {
    const actor = await this.analyses.actor(userId)
    if (receipt.mimeType !== 'application/pdf') {
      await this.execution.run(userId, signal, () => this.ocr.inspect(receipt, signal))
    }
    return this.analyses.launch(actor, receipt, key, signal)
  }

  async find(userId: string, id: string) {
    return this.analyses.find(await this.analyses.actor(userId), id)
  }
}
