import { validateReceipt, type Receipt } from '@/domain/receipt/Receipt'
import { inspectReceipt } from '@/adapters/inspectReceipt'
import { InputError, validateInput } from './validation'
import { multipartFields, readMultipart } from './readMultipart'

export async function readReceipt(request: Request, signal: AbortSignal, options: { allowUnsupported?: boolean } = {}): Promise<Receipt> {
  const fields = multipartFields(await readMultipart(request, signal))
  const file = fields.receipt
  validateInput('ReceiptInput', { ...fields, ...(file instanceof File ? { receipt: '' } : {}) })
  if (!(file instanceof File)) throw new InputError()
  const receipt = { data: Buffer.from(await file.arrayBuffer()), mimeType: file.type }
  if (!receipt.data.length) throw new InputError('VALIDATION_ERROR', [{ field: 'receipt', code: 'EMPTY_FILE', message: 'A non-empty file is required.' }])
  validateReceipt(receipt, options)
  // Image decoding remains in the isolated, bounded OCR process. PDFs need a real parser.
  if (receipt.mimeType === 'application/pdf') await inspectReceipt(receipt)
  return receipt
}
