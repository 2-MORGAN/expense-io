// Nettoyage unique des notes sans reçu (`receipt_key = ''`), 2-476 étape 3,
// ADR-003 §3. Une note sans reçu vient d'un échec d'upload de l'ancien parcours
// (INSERT, puis upload, puis UPDATE) :
//   - `pending` : l'utilisateur a reçu une erreur 500, la note n'existe pas de
//     son point de vue et a souvent été doublée par un renvoi → supprimée ;
//   - `approved` / `rejected` : une décision prise ne s'efface pas en silence
//     → conservée et listée pour la RH.
// Par défaut : dry-run, rapport seul. `--execute --out <dossier>` exporte
// d'abord toutes ces notes en CSV, supprime les `pending`, puis valide la
// contrainte `receipt_key <> ''` s'il ne reste aucune note sans reçu.
// Options : `--company <uuid>` limite à une entreprise, `--skip-validate`
// laisse la contrainte non validée.
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { config as loadEnv } from 'dotenv'
import { Pool } from 'pg'

loadEnv({ quiet: true })

const CONSTRAINT = 'expense_notes_receipt_key_not_empty'
const args = process.argv.slice(2)
const option = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const execute = args.includes('--execute')
const skipValidate = args.includes('--skip-validate')
const companyId = option('--company')
const outDir = option('--out')

if (execute && !outDir) {
  console.error('--execute exige --out <dossier> : l’export CSV précède toute suppression.')
  process.exit(2)
}

const csvCell = (value) => {
  const text = value instanceof Date ? value.toISOString() : String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
try {
  const { rows } = await pool.query(
    `SELECT e.id, e.status, e.amount, e.expense_date, e.description, e.created_at,
            e.decided_by, e.decided_at, u.id AS user_id, u.email, u.company_id
     FROM expense_notes e JOIN users u ON u.id = e.user_id
     WHERE e.receipt_key = '' AND ($1::uuid IS NULL OR u.company_id = $1)
     ORDER BY e.created_at`,
    [companyId ?? null]
  )
  const pending = rows.filter((row) => row.status === 'pending')
  const decided = rows.filter((row) => row.status !== 'pending')
  console.log(`Notes sans reçu : ${rows.length} (à supprimer, en attente : ${pending.length} ; à conserver, déjà décidées : ${decided.length}).`)
  for (const row of decided) {
    console.log(`  À traiter par la RH : ${row.id} ${row.status} ${row.email} ${row.amount} € « ${row.description} »`)
  }

  if (!execute) {
    console.log('Dry-run : rien n’a été modifié. Relancer avec --execute --out <dossier>.')
  } else {
    mkdirSync(outDir, { recursive: true })
    const header = ['id', 'status', 'amount', 'expense_date', 'description', 'created_at', 'decided_by', 'decided_at', 'user_id', 'email', 'company_id']
    const csv = [header, ...rows.map((row) => header.map((column) => row[column]))]
      .map((line) => line.map(csvCell).join(','))
      .join('\n')
    const file = path.join(outDir, `notes-sans-recu-${new Date().toISOString().replaceAll(':', '-')}.csv`)
    writeFileSync(file, `${csv}\n`, { flag: 'wx' })
    console.log(`Export écrit : ${file}`)

    const removed = await pool.query(
      `DELETE FROM expense_notes WHERE id = ANY($1::uuid[]) AND status = 'pending' AND receipt_key = ''`,
      [pending.map((row) => row.id)]
    )
    console.log(`Notes en attente supprimées : ${removed.rowCount}.`)
  }

  const remaining = await pool.query(`SELECT count(*)::int AS n FROM expense_notes WHERE receipt_key = ''`)
  if (!execute) {
    // rien à valider en dry-run
  } else if (skipValidate) {
    console.log('Validation de la contrainte sautée (--skip-validate).')
  } else if (remaining.rows[0].n > 0) {
    console.log(`Contrainte ${CONSTRAINT} non validée : ${remaining.rows[0].n} note(s) sans reçu subsistent (la contrainte refuse déjà toute nouvelle).`)
  } else {
    // Nom écrit en clair : une commande DDL ne prend pas de paramètre.
    await pool.query('ALTER TABLE expense_notes VALIDATE CONSTRAINT expense_notes_receipt_key_not_empty')
    console.log(`Contrainte ${CONSTRAINT} validée.`)
  }
} finally {
  await pool.end()
}
