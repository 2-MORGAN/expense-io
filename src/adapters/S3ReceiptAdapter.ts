import { getReceiptUrl, uploadReceipt } from '@/lib/storage'
import type { ReceiptStoragePort } from '@/ports/ReceiptStoragePort'

export class S3ReceiptAdapter implements ReceiptStoragePort {
  async upload(key: string, body: Buffer, contentType: string): Promise<void> {
    await uploadReceipt(key, body, contentType)
  }

  async getSignedUrl(key: string, expiresInSeconds = 300): Promise<string> {
    return getReceiptUrl(key, expiresInSeconds)
  }
}
