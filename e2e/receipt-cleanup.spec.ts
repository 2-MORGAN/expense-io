import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createCompany, createUser, db } from './support/db'
import { databaseUrl } from './support/env'
import { expect, test } from './support/fixtures'

// 2-476 étape 3 (ADR-003 §3) : plus de note sans reçu, et nettoyage de l'existant.
const CONSTRAINT = 'expense_notes_receipt_key_not_empty'
const SCRIPT = path.resolve('scripts/clean-notes-without-receipt.mjs')

/**
 * Crée des notes « héritées » (clé vide), que la contrainte interdit désormais :
 * elle est retirée puis reposée NOT VALID dans la même transaction, comme à la
 * migration, donc sans fenêtre où une autre insertion passerait.
 */
async function insertLegacyNotes(
  notes: { userId: string; status: 'pending' | 'approved'; description: string }[]
): Promise<string[]> {
  const client = await db().connect()
  try {
    await client.query('BEGIN')
    await client.query(`ALTER TABLE expense_notes DROP CONSTRAINT ${CONSTRAINT}`)
    const ids: string[] = []
    for (const note of notes) {
      const { rows } = await client.query(
        `INSERT INTO expense_notes (user_id, amount, expense_date, description, receipt_key, status)
         VALUES ($1, 10, '2026-10-01', $2, '', $3) RETURNING id`,
        [note.userId, note.description, note.status]
      )
      ids.push(rows[0].id)
    }
    await client.query(`ALTER TABLE expense_notes ADD CONSTRAINT ${CONSTRAINT} CHECK (receipt_key <> '') NOT VALID`)
    await client.query('COMMIT')
    return ids
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

function runScript(args: string[]): string {
  return execFileSync('node', [SCRIPT, ...args, '--skip-validate'], {
    env: { ...process.env, DATABASE_URL: databaseUrl() },
    encoding: 'utf8',
  })
}

const existing = async (ids: string[]) =>
  (await db().query('SELECT id FROM expense_notes WHERE id = ANY($1::uuid[])', [ids])).rows.map((r) => r.id as string)

test.describe('Notes sans reçu : contrainte et nettoyage', () => {
  test('[CLEAN-01] la base refuse une note sans reçu, à l’insertion comme à la mise à jour', async ({ org, apiAs }) => {
    await expect(
      db().query(
        `INSERT INTO expense_notes (user_id, amount, expense_date, description, receipt_key)
         VALUES ($1, 10, '2026-10-01', 'sans reçu', '')`,
        [org.employee.id]
      )
    ).rejects.toMatchObject({ code: '23514', constraint: CONSTRAINT })

    const note = await (await apiAs(org.employee)).submitNote()
    await expect(db().query(`UPDATE expense_notes SET receipt_key = '' WHERE id = $1`, [note.id])).rejects.toMatchObject({
      code: '23514',
    })
  })

  test('[CLEAN-02] dry-run : rapport sans rien modifier', async ({ org }) => {
    const ids = await insertLegacyNotes([
      { userId: org.employee.id, status: 'pending', description: 'héritée en attente' },
      { userId: org.employee.id, status: 'approved', description: 'héritée décidée' },
    ])
    const output = runScript(['--company', org.company.id])
    expect(output).toContain('Notes sans reçu : 2 (à supprimer, en attente : 1 ; à conserver, déjà décidées : 1)')
    expect(output).toContain('Dry-run')
    expect(await existing(ids)).toHaveLength(2)
  })

  test('[CLEAN-03] --execute : CSV de tout, suppression des seules notes en attente, décidées conservées, autre entreprise intacte', async ({
    org,
  }) => {
    const other = await createCompany('autre')
    const stranger = await createUser(other, { name: 'Etienne Autre', role: 'employee' })
    const [pending1, pending2, approved, foreign] = await insertLegacyNotes([
      { userId: org.employee.id, status: 'pending', description: 'en attente 1' },
      { userId: org.employee.id, status: 'pending', description: 'en attente 2' },
      { userId: org.employee.id, status: 'approved', description: 'décidée, à conserver' },
      { userId: stranger.id, status: 'pending', description: 'autre entreprise' },
    ])
    const out = mkdtempSync(path.join(tmpdir(), 'clean-notes-'))
    try {
      const output = runScript(['--execute', '--out', out, '--company', org.company.id])
      expect(output).toContain('Notes en attente supprimées : 2.')
      expect(output).toContain(`À traiter par la RH : ${approved}`)

      const files = readdirSync(out)
      expect(files).toHaveLength(1)
      const csv = readFileSync(path.join(out, files[0]), 'utf8')
      for (const id of [pending1, pending2, approved]) expect(csv).toContain(id)
      expect(csv).not.toContain(foreign)

      expect(await existing([pending1, pending2, approved, foreign])).toEqual(
        expect.arrayContaining([approved, foreign])
      )
      expect(await existing([pending1, pending2])).toEqual([])
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  })

  test('[CLEAN-04] --execute sans --out : refusé, rien n’est supprimé', async ({ org }) => {
    const [id] = await insertLegacyNotes([{ userId: org.employee.id, status: 'pending', description: 'protégée' }])
    expect(() => runScript(['--execute', '--company', org.company.id])).toThrow()
    expect(await existing([id])).toEqual([id])
  })
})
