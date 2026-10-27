import sharp from 'sharp'
import { PDFDocument } from 'pdf-lib'
import { OcrError } from '@/domain/receipt/OcrError'
import { validateReceipt, type Receipt } from '@/domain/receipt/Receipt'

/** Shared content validation, without OCR, resizing, upload or persistence. */
export async function inspectReceipt(receipt: Receipt): Promise<void> {
  validateReceipt(receipt)
  try {
    if (receipt.mimeType === 'application/pdf') {
      // A signature is insufficient: require a complete PDF with a valid page tree.
      if (!/%%EOF\s*$/.test(receipt.data.subarray(-1024).toString('latin1'))) throw new Error('Incomplete PDF')
      const pdf = await PDFDocument.load(receipt.data, { throwOnInvalidObject: true, updateMetadata: false })
      if (pdf.getPageCount() < 1) throw new Error('Missing PDF page')
      pdf.getPages().forEach((page) => page.getSize())
      return
    }
    const expected = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/webp': 'webp' }[receipt.mimeType]
    const image = sharp(receipt.data, { failOn: 'warning' })
    const metadata = await image.metadata()
    if (!expected || metadata.format !== expected) throw new Error('MIME mismatch')
    // Decode every page, without retaining a full uncompressed bitmap in JS.
    await sharp(receipt.data, { animated: true, failOn: 'warning' }).stats()
  } catch {
    throw new OcrError('RECEIPT_TYPE_NOT_ALLOWED')
  }
}
