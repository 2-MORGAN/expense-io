import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { databaseUrl, S3_BUCKET, S3_CONFIG } from './support/env'
import { expect, test } from './support/fixtures'

// 2-476 bonus (ADR-003 §3) : réconciliation des reçus orphelins. Chaque test
// travaille sous le préfixe de sa propre entreprise (`--company`), donc sans
// toucher aux uploads des autres tests.
const SCRIPT = path.resolve('scripts/reconcile-orphan-receipts.mjs')

const run = (args: string[]) =>
  execFileSync(process.execPath, [SCRIPT, ...args], { env: { ...process.env, DATABASE_URL: databaseUrl() }, encoding: 'utf8' })

async function put(s3: S3Client, key: string) {
  await s3.send(new PutObjectCommand({ Bucket: S3_BUCKET, Key: key, Body: Buffer.from('orphan'), ContentType: 'image/png' }))
}

async function exists(s3: S3Client, key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: key }))
    return true
  } catch (error) {
    if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return false
    throw error
  }
}

test.describe('Réconciliation des reçus orphelins', () => {
  test('[REC-01] dry-run : liste l’orphelin, ne supprime rien', async ({ org }) => {
    const s3 = new S3Client(S3_CONFIG)
    try {
      const orphan = `receipts/${org.company.id}/${randomUUID()}.png`
      await put(s3, orphan)
      const output = run(['--company', org.company.id, '--older-than-hours', '0'])
      expect(output).toContain(orphan)
      expect(output).toContain('Dry-run')
      expect(await exists(s3, orphan)).toBe(true)
    } finally {
      s3.destroy()
    }
  })

  test('[REC-02] --execute : supprime l’orphelin, garde le reçu d’une note', async ({ org, apiAs }) => {
    const s3 = new S3Client(S3_CONFIG)
    try {
      const note = await (await apiAs(org.employee)).submitNote()
      const kept = `receipts/${org.company.id}/${note.id}.png`
      const orphan = `receipts/${org.company.id}/${randomUUID()}.png`
      await put(s3, orphan)

      const output = run(['--company', org.company.id, '--older-than-hours', '0', '--execute'])
      expect(output).toContain('Objets supprimés : 1.')
      expect(await exists(s3, orphan)).toBe(false)
      expect(await exists(s3, kept)).toBe(true)
    } finally {
      s3.destroy()
    }
  })

  test('[REC-03] délai de 24 h : un objet récent n’est jamais supprimé, même avec --execute', async ({ org }) => {
    const s3 = new S3Client(S3_CONFIG)
    try {
      const recent = `receipts/${org.company.id}/${randomUUID()}.png`
      await put(s3, recent)
      const output = run(['--company', org.company.id, '--execute'])
      expect(output).toContain('orphelins de plus de 24 h : 0')
      expect(await exists(s3, recent)).toBe(true)
    } finally {
      s3.destroy()
    }
  })

  test('[REC-04] un objet sous le préfixe d’une autre entreprise n’est pas touché', async ({ org }) => {
    const s3 = new S3Client(S3_CONFIG)
    try {
      const foreign = `receipts/${randomUUID()}/${randomUUID()}.png`
      await put(s3, foreign)
      run(['--company', org.company.id, '--older-than-hours', '0', '--execute'])
      expect(await exists(s3, foreign)).toBe(true)
    } finally {
      s3.destroy()
    }
  })
})
