import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { db } from './support/db'
import { S3_BUCKET, S3_CONFIG } from './support/env'
import { expect, test } from './support/fixtures'
import { pngReceipt } from './support/files'

// 2-476 étape 1 (ADR-003 §3) : le reçu est stocké d'abord, la note est écrite en
// une seule fois avec sa clé. Aucun test existant n'est modifié.
test.describe('Soumission de note : upload d’abord, une seule transaction', () => {
  test('[SOUM-01] la note naît avec sa clé : receipts/{entreprise}/{id de la note}.ext, objet présent', async ({
    org,
    apiAs,
  }) => {
    const note = await (await apiAs(org.employee)).submitNote({ receipt: pngReceipt('soum-01') })

    const row = (await db().query('SELECT receipt_key FROM expense_notes WHERE id = $1', [note.id])).rows[0]
    expect(row.receipt_key).toBe(`receipts/${org.company.id}/${note.id}.png`)

    const s3 = new S3Client(S3_CONFIG)
    try {
      const head = await s3.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: row.receipt_key }))
      expect(head.ContentType).toBe('image/png')
    } finally {
      s3.destroy()
    }
  })

  test('[SOUM-02] jamais de note sans reçu : aucune note de l’entreprise n’a de clé vide', async ({ org, apiAs }) => {
    const api = await apiAs(org.employee)
    await api.submitNote({ receipt: pngReceipt('soum-02a') })
    await api.submitNote({ receipt: pngReceipt('soum-02b') })

    const { rows } = await db().query(
      `SELECT count(*)::int AS n FROM expense_notes e JOIN users u ON u.id = e.user_id
       WHERE u.company_id = $1 AND (e.receipt_key = '' OR e.receipt_key NOT LIKE $2)`,
      [org.company.id, `receipts/${org.company.id}/%`]
    )
    expect(rows[0].n).toBe(0)
  })
})
