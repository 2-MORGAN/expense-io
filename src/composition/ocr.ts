import { withOcrExecution } from '@/adapters/PostgresOcrExecution'
import { OcrRequests } from '@/modules/receipt-analysis/application/OcrRequests'
import { TesseractOcrAdapter } from '@/adapters/TesseractOcrAdapter'
import { PostgresReceiptAnalysisRepository } from '@/adapters/PostgresReceiptAnalysisRepository'
import { S3ReceiptAdapter } from '@/adapters/S3ReceiptAdapter'
import { OcrCapacity } from '@/modules/receipt-analysis/application/OcrCapacity'
import { SuggestReceiptFields } from '@/modules/receipt-analysis/application/SuggestReceiptFields'
import { ReceiptAnalyses } from '@/modules/receipt-analysis/application/ReceiptAnalyses'

const state = globalThis as typeof globalThis & { __ocrCapacity?: OcrCapacity }
export const ocrCapacity = state.__ocrCapacity ??= new OcrCapacity()
export const ocrAdapter = new TesseractOcrAdapter()
export const suggestReceiptFields = new SuggestReceiptFields(ocrAdapter)
export const receiptAnalyses = new ReceiptAnalyses(new PostgresReceiptAnalysisRepository(), new S3ReceiptAdapter())

export const ocrExecution = { run: withOcrExecution }
export const ocrRequests = new OcrRequests(suggestReceiptFields, receiptAnalyses, ocrAdapter, ocrExecution)
