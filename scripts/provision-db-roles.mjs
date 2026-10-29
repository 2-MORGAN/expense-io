// @ts-check
// Mots de passe des rôles de connexion (ADR-001, annexe B, 2-481), lancé par
// `npm run migrate:up` après les migrations. Ils viennent de l'environnement
// (`DATABASE_URL`, `WORKER_DATABASE_URL`), jamais du dépôt : chaque machine
// pose sur sa base ceux de son `.env`. Idempotent, rejoué à chaque migration.
import { config as loadEnv } from 'dotenv'
import { Client } from 'pg'

loadEnv({ quiet: true })

const ROLES = [
  { variable: 'DATABASE_URL', role: 'expense_app' },
  { variable: 'WORKER_DATABASE_URL', role: 'expense_worker' },
]

const adminUrl = process.env.MIGRATION_DATABASE_URL
if (!adminUrl) {
  console.error('MIGRATION_DATABASE_URL absent : reprendre les variables de base de données de .env.example dans .env.')
  process.exit(1)
}

const client = new Client({ connectionString: adminUrl })
await client.connect()
try {
  for (const { variable, role } of ROLES) {
    const url = process.env[variable]
    if (!url) {
      console.warn(`${variable} absent : mot de passe de ${role} non posé (voir .env.example).`)
      continue
    }
    const parsed = new URL(url)
    const user = decodeURIComponent(parsed.username)
    if (user !== role) {
      // Ancien .env resté sur le propriétaire : rien à poser, le contrôle du
      // rôle au démarrage le signale.
      console.warn(`${variable} se connecte avec « ${user} » et non « ${role} » : mot de passe non posé (voir .env.example).`)
      continue
    }
    const password = decodeURIComponent(parsed.password)
    if (!password) {
      console.error(`${variable} ne contient pas de mot de passe.`)
      process.exitCode = 1
      continue
    }
    // ALTER ROLE n'accepte pas de paramètre : la commande est construite par
    // la base, `%I` et `%L` échappent le nom et le mot de passe.
    const { rows } = await client.query("SELECT format('ALTER ROLE %I LOGIN PASSWORD %L', $1::text, $2::text) AS sql", [
      role,
      password,
    ])
    await client.query(rows[0].sql)
    console.log(`Mot de passe de ${role} posé depuis ${variable}.`)
  }
} finally {
  await client.end()
}
