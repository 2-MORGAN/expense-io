import { OcrError } from './OcrError'
import { MAX_RECEIPT_BYTES } from './limits'

export interface Receipt {
  data: Buffer
  mimeType: string
}

export function validateReceipt(receipt: Receipt): void {
  if (receipt.data.length === 0) throw new OcrError('VALIDATION_ERROR')
  if (receipt.data.length > MAX_RECEIPT_BYTES) throw new OcrError('RECEIPT_TOO_LARGE')
  const data = receipt.data
  const matches = receipt.mimeType === 'image/png'
    ? data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : receipt.mimeType === 'image/jpeg'
      ? data[0] === 255 && data[1] === 216 && data[2] === 255
      : receipt.mimeType === 'image/webp'
        ? data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP'
        : receipt.mimeType === 'application/pdf'
          ? data.toString('ascii', 0, 5) === '%PDF-'
          : false
  if (!matches) throw new OcrError('RECEIPT_TYPE_NOT_ALLOWED')
}
