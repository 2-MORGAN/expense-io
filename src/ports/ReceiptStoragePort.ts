export interface ReceiptStoragePort {
  upload(key: string, body: Buffer, contentType: string, signal?: AbortSignal): Promise<void>
  getSignedUrl(key: string, expiresInSeconds?: number): Promise<string>
  read(key: string, signal: AbortSignal): Promise<Buffer>
  delete(key: string): Promise<void>
}
