import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { MAX_RECEIPT_BYTES } from '@/domain/receipt/limits'

let client: S3Client | undefined

function getClient(): S3Client {
  if (!client) {
    client = new S3Client({
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION ?? 'us-east-1',
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
      },
    })
  }
  return client
}

const BUCKET = process.env.S3_BUCKET ?? 'receipts'

// Nom de fichier lisible, dérivé du compteur de reçu de la note plutôt que
// d'un identifiant opaque.
export function receiptKeyFor(receiptSeq: number, extension: string): string {
  return `receipts/${receiptSeq}${extension}`
}

export async function uploadReceipt(key: string, body: Buffer, contentType: string, signal?: AbortSignal): Promise<void> {
  await getClient().send(
    new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType }),
    { abortSignal: signal }
  )
}

export async function getReceiptUrl(key: string, expiresInSeconds = 300): Promise<string> {
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: key })
  return getSignedUrl(getClient(), command, { expiresIn: expiresInSeconds })
}

export async function deleteReceipt(key: string): Promise<void> {
  await getClient().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }), { abortSignal: AbortSignal.timeout(5000) })
}

export async function readReceipt(key: string, signal: AbortSignal): Promise<Buffer> {
  const response = await getClient().send(new GetObjectCommand({ Bucket: BUCKET, Key: key }), { abortSignal: signal })
  if (!response.Body) throw new Error('Missing receipt body')
  const reader = response.Body.transformToWebStream().getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      signal.throwIfAborted()
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_RECEIPT_BYTES) throw new Error('Stored receipt exceeds limit')
      chunks.push(value)
    }
    return Buffer.concat(chunks)
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
