import { receiptInspector } from '@/composition/receipts'
import { OcrError } from '@/domain/receipt/OcrError'
import { InputError, validateInput } from './validation'
import { multipartFields, readMultipart } from './readMultipart'

export async function readExpenseInput(request: Request) {
  const fields = multipartFields(await readMultipart(request))
  const receipt = fields.receipt
  const projection = { ...fields, ...(receipt instanceof File ? { receipt: '' } : {}) }
  const input = validateInput('CreateExpenseNote', projection)
  if (!(receipt instanceof File)) throw new InputError()
  try {
    await receiptInspector.inspect({ data: Buffer.from(await receipt.arrayBuffer()), mimeType: receipt.type })
  } catch (error) {
    if (error instanceof OcrError) {
      if (error.code === 'RECEIPT_TOO_LARGE' || error.code === 'RECEIPT_TYPE_NOT_ALLOWED') throw new InputError(error.code)
      throw new InputError('VALIDATION_ERROR', [{ field: 'receipt', code: 'EMPTY_FILE', message: 'A non-empty file is required.' }])
    }
    throw error
  }
  return { ...input, amount: Number(input.amount), receipt }
}
