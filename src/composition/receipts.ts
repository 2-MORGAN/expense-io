import { inspectReceipt } from '@/modules/expenses/adapters/inspectReceipt'
import type { ReceiptInspector } from '@/modules/expenses/ports/ReceiptInspector'

export const receiptInspector: ReceiptInspector = { inspect: inspectReceipt }
