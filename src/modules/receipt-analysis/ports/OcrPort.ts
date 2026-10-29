import type { Receipt } from '@/modules/receipt-analysis/domain/Receipt'

export interface OcrPort {
  inspect(receipt: Receipt, signal: AbortSignal): Promise<void>
  recognize(receipt: Receipt, signal: AbortSignal): Promise<string>
}
