import { deleteReceipt, getReceiptUrl, readReceipt, uploadReceipt } from '@/lib/storage'
import type { ReceiptStoragePort } from '@/ports/ReceiptStoragePort'

export class S3ReceiptAdapter implements ReceiptStoragePort {
  async upload(key: string, body: Buffer, contentType: string, signal?: AbortSignal): Promise<void> {
    await uploadReceipt(key, body, contentType, signal)
  }

  async getSignedUrl(key: string, expiresInSeconds = 300): Promise<string> {
    return getReceiptUrl(key, expiresInSeconds)
  }

  read(key: string, signal: AbortSignal): Promise<Buffer> { return readReceipt(key, signal) }
  delete(key: string): Promise<void> { return deleteReceipt(key) }
}
