import { inspectReceipt } from '@/adapters/inspectReceipt'
import type { ReceiptInspector } from '@/ports/ReceiptInspector'

export const receiptInspector: ReceiptInspector = { inspect: inspectReceipt }
