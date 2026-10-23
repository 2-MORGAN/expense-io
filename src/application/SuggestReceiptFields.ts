import type { Receipt } from '@/domain/receipt/Receipt'
import { validateReceipt } from '@/domain/receipt/Receipt'
import { parseAmount, parseExpenseDate, type ExpenseNoteSuggestion } from '@/domain/receipt/parseReceiptText'
import type { OcrPort } from '@/ports/OcrPort'

export class SuggestReceiptFields {
  constructor(private ocr: OcrPort) {}

  async execute(receipt: Receipt, signal: AbortSignal): Promise<ExpenseNoteSuggestion> {
    validateReceipt(receipt)
    signal.throwIfAborted()
    if (receipt.mimeType === 'application/pdf') return {}
    const text = await this.ocr.recognize(receipt, signal)
    signal.throwIfAborted()
    return { amount: parseAmount(text), expenseDate: parseExpenseDate(text) }
  }
}
