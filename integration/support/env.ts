import { config as loadEnv } from 'dotenv'

// Même source de configuration que l'application, les scripts et les E2E :
// `.env` s'il existe, sinon les variables déjà présentes (CI, `make env`).
// Chargé avant tout module de src/ : `src/lib/storage.ts` lit le bucket à
// l'import.
loadEnv({ quiet: true })

function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`[integration] ${name} absent : copier .env.example vers .env (\`make env\`).`)
  }
  return value
}

/** Rôle de l'application (`expense_app`), soumis à la RLS : celui du code testé. */
export const APP_DATABASE_URL = required('DATABASE_URL')

/** Rôle du worker (`expense_worker`) : jetons d'email, nettoyage des reçus. */
export const WORKER_DATABASE_URL = required('WORKER_DATABASE_URL')

/** Propriétaire des tables : préparation et contrôle des données de test, hors RLS. */
export const OWNER_DATABASE_URL = process.env.MIGRATION_DATABASE_URL ?? required('E2E_DATABASE_URL')

export const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://localhost:8025'

export const S3_BUCKET = process.env.S3_BUCKET ?? 'receipts'

export const S3_CONFIG = {
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION ?? 'us-east-1',
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
  },
}
