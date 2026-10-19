import { config as loadEnv } from 'dotenv'

// Même source de configuration que l'application et les scripts (seed,
// ensure-bucket) : `.env` s'il existe, sinon les variables déjà présentes
// dans l'environnement (CI).
loadEnv({ quiet: true })

/** URL de l'application testée. Par défaut le serveur de dev de `make dev`. */
export const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000'

/**
 * Connexion directe à la base, utilisée uniquement pour préparer les données
 * (entreprises, comptes et rôles). `E2E_DATABASE_URL` permet d'utiliser un
 * rôle d'administration distinct de celui de l'application si besoin.
 */
export function databaseUrl(): string {
  const url = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL
  if (!url) {
    throw new Error(
      'DATABASE_URL absent : copier .env.example vers .env (ou définir E2E_DATABASE_URL).'
    )
  }
  return url
}

export const S3_CONFIG = {
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION ?? 'us-east-1',
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
  },
}

export const S3_BUCKET = process.env.S3_BUCKET ?? 'receipts'
