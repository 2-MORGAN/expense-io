export interface ReceiptStoragePort {
  upload(key: string, body: Buffer, contentType: string): Promise<void>
  getSignedUrl(key: string, expiresInSeconds?: number): Promise<string>
}
