import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { S3_BUCKET, S3_CONFIG } from './env'

// Contrôle direct du bucket de docker-compose.yml : ce que le code testé y a
// écrit, ou supprimé.

let client: S3Client | undefined

/** Type de l'objet stocké sous `key`, ou null s'il n'existe pas. */
export async function storedType(key: string): Promise<string | null> {
  client ??= new S3Client(S3_CONFIG)
  try {
    const head = await client.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: key }))
    return head.ContentType ?? ''
  } catch (error) {
    if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return null
    throw error
  }
}
