// Réconciliation des reçus orphelins, 2-476 bonus, ADR-003 §3. Un objet de
// `receipts/` qui n'est référencé ni par une note (`expense_notes.receipt_key`)
// ni par une analyse OCR en cours (`receipt_analyses.receipt_key`) et qui a plus
// de 24 h est un reste d'upload dont la compensation a échoué : le délai
// protège les uploads en cours (le reçu est envoyé avant l'écriture de la note).
// Par défaut : dry-run, rapport seul (premier passage obligatoire). `--execute`
// supprime. Chaque objet est re-vérifié en base juste avant sa suppression.
// Options : `--company <uuid>` limite au préfixe `receipts/<uuid>/`,
// `--older-than-hours <n>` change le délai (24 par défaut ; 0 réservé aux tests).
// À planifier une fois par jour (cron) après un premier dry-run relu.
import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3'
import { config as loadEnv } from 'dotenv'
import { Pool } from 'pg'

loadEnv({ quiet: true })

const args = process.argv.slice(2)
const option = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const execute = args.includes('--execute')
const companyId = option('--company')
const olderThanHours = Number(option('--older-than-hours') ?? 24)
if (!Number.isFinite(olderThanHours) || olderThanHours < 0) {
  console.error('--older-than-hours doit être un nombre positif ou nul.')
  process.exit(2)
}

const bucket = process.env.S3_BUCKET ?? 'receipts'
const prefix = companyId ? `receipts/${companyId}/` : 'receipts/'
const cutoff = Date.now() - olderThanHours * 3_600_000

const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION ?? 'us-east-1',
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
  },
})
const pool = new Pool({ connectionString: process.env.DATABASE_URL })

const isReferenced = async (keys) => {
  const { rows } = await pool.query(
    `SELECT receipt_key FROM expense_notes WHERE receipt_key = ANY($1::text[])
     UNION SELECT receipt_key FROM receipt_analyses WHERE receipt_key = ANY($1::text[])`,
    [keys]
  )
  return new Set(rows.map((row) => row.receipt_key))
}

try {
  let scanned = 0
  const orphans = []
  let token
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }))
    const old = (page.Contents ?? []).filter((object) => object.LastModified && object.LastModified.getTime() <= cutoff)
    scanned += page.Contents?.length ?? 0
    if (old.length > 0) {
      const referenced = await isReferenced(old.map((object) => object.Key))
      orphans.push(...old.filter((object) => !referenced.has(object.Key)))
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined
  } while (token)

  console.log(`Objets sous ${prefix} : ${scanned} ; orphelins de plus de ${olderThanHours} h : ${orphans.length}.`)
  for (const object of orphans) console.log(`  ${object.Key} (${object.LastModified.toISOString()}, ${object.Size} octets)`)

  if (!execute) {
    console.log('Dry-run : rien n’a été supprimé. Relancer avec --execute après relecture.')
  } else {
    let deleted = 0
    for (let i = 0; i < orphans.length; i += 1000) {
      const batch = orphans.slice(i, i + 1000)
      // Une note a pu référencer l'objet depuis le listage : on re-vérifie.
      const referenced = await isReferenced(batch.map((object) => object.Key))
      const toDelete = batch.filter((object) => !referenced.has(object.Key))
      if (toDelete.length === 0) continue
      const result = await s3.send(
        new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: toDelete.map((object) => ({ Key: object.Key })), Quiet: true } })
      )
      deleted += toDelete.length - (result.Errors?.length ?? 0)
      for (const error of result.Errors ?? []) console.error(`  Échec : ${error.Key} ${error.Code}`)
    }
    console.log(`Objets supprimés : ${deleted}.`)
  }
} finally {
  await pool.end()
  s3.destroy()
}
