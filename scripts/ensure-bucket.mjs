// Crée le bucket S3 (LocalStack) si besoin — retente pendant quelques
// secondes le temps que le service finisse de démarrer.
import {
  CreateBucketCommand,
  HeadBucketCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { config as loadEnv } from 'dotenv'

// Nécessaire en local (make/npm invoquent ce script directement, sans passer
// par --envPath comme node-pg-migrate) ; no-op silencieux en CI où .env
// n'existe pas et les variables sont déjà dans l'environnement du job.
loadEnv({ quiet: true })

const client = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION ?? 'us-east-1',
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
  },
})

const bucket = process.env.S3_BUCKET ?? 'receipts'
const maxAttempts = 15

for (let attempt = 1; attempt <= maxAttempts; attempt++) {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }))
    console.log(`Bucket "${bucket}" existe déjà.`)
    process.exit(0)
  } catch (headError) {
    try {
      await client.send(new CreateBucketCommand({ Bucket: bucket }))
      console.log(`Bucket "${bucket}" créé.`)
      process.exit(0)
    } catch (createError) {
      if (attempt === maxAttempts) {
        console.error(
          `Échec de la création du bucket "${bucket}" après ${maxAttempts} tentatives.`,
          headError,
          createError
        )
        process.exit(1)
      }
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }
}
