import type { Receipt } from '@/modules/receipt-analysis/domain/Receipt'
import { validateReceipt, isSupportedReceiptType } from '@/modules/receipt-analysis/domain/Receipt'
import { parseAmount, parseDescription, parseExpenseDate, type ExpenseNoteSuggestion } from '@/modules/receipt-analysis/domain/parseReceiptText'
import type { OcrPort } from '@/ports/OcrPort'

export class SuggestReceiptFields {
  constructor(private ocr: OcrPort) {}

  async execute(receipt: Receipt, signal: AbortSignal): Promise<ExpenseNoteSuggestion> {
    validateReceipt(receipt, { allowUnsupported: true })
    signal.throwIfAborted()
    if (receipt.mimeType === 'application/pdf' || !isSupportedReceiptType(receipt.mimeType)) return {}
    const text = await this.ocr.recognize(receipt, signal)
    signal.throwIfAborted()
    return { amount: parseAmount(text), expenseDate: parseExpenseDate(text), description: parseDescription(text) }
  }
}
