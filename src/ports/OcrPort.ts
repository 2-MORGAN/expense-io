import type { Receipt } from '@/domain/receipt/Receipt'

export interface OcrPort {
  inspect(receipt: Receipt, signal: AbortSignal): Promise<void>
  recognize(receipt: Receipt, signal: AbortSignal): Promise<string>
}
