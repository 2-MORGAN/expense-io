import type { OutboxEvent } from './OutboxPort'
import type { ExpenseNoteSuggestion } from '@/domain/receipt/parseReceiptText'
import type { OcrErrorCode } from '@/domain/receipt/OcrError'

export interface AnalysisPayload {
  version: 1; analysisId: string; userId: string; companyId: string; receiptKey: string
}

export interface ReceiptAnalysisWorkPort {
  start(event: OutboxEvent, payload: AnalysisPayload): Promise<string | null>
  finish(event: OutboxEvent, payload: AnalysisPayload | null, result?: ExpenseNoteSuggestion, failure?: OcrErrorCode): Promise<void>
}
