import type { ExpenseNoteSuggestion } from '@/modules/receipt-analysis/domain/parseReceiptText'
import type { OcrErrorCode } from '@/modules/receipt-analysis/domain/OcrError'

export interface AnalysisActor { userId: string; companyId: string }
export interface ReceiptAnalysis {
  id: string
  status: 'queued' | 'running' | 'succeeded' | 'failed'
  result?: ExpenseNoteSuggestion
  errorCode?: OcrErrorCode
}
export interface NewReceiptAnalysis {
  id: string; receiptKey: string; mimeType: string; fingerprint: string; idempotencyKey: string
}
export interface ReceiptAnalysisRepository {
  actor(userId: string): Promise<AnalysisActor>
  find(actor: AnalysisActor, id: string): Promise<ReceiptAnalysis | null>
  replay(actor: AnalysisActor, key: string, fingerprint: string): Promise<ReceiptAnalysis | null>
  enqueue(actor: AnalysisActor, input: NewReceiptAnalysis): Promise<ReceiptAnalysis>
}
