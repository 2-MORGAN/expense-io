import { randomUUID } from 'node:crypto'
import { db } from './support/db'
import { expect, test } from './support/fixtures'

// Point 3 de la revue de l'API (27/10) : ADR-004 §7.2 prévoit un départage
// par `id` pour un ordre stable. Les lignes sont insérées dans un ordre qui
// n'est ni croissant ni décroissant par id : sans départage, PostgreSQL rend
// les égalités dans l'ordre de lecture, et le test échoue.

const SHUFFLE = [2, 0, 4, 1, 3]

/** Cinq UUID triés comme PostgreSQL les trie (octets = hexadécimal minuscule). */
function sortedIds(): string[] {
  return Array.from({ length: SHUFFLE.length }, () => randomUUID()).sort()
}

/** Notes identiques sur toutes les colonnes triables, y compris `created_at`. */
async function insertTiedNotes(userId: string): Promise<string[]> {
  const ids = sortedIds()
  for (const index of SHUFFLE) {
    await db().query(
      `INSERT INTO expense_notes (id, user_id, amount, expense_date, description, receipt_key, status, created_at)
       VALUES ($1, $2, 42, '2026-10-01', 'Égalité de tri', $3, 'pending', '2026-10-01T10:00:00Z')`,
      [ids[index], userId, `receipts/e2e-tri/${ids[index]}.png`]
    )
  }
  return ids
}

const descending = (ids: string[]) => [...ids].reverse()

test.describe('Ordre stable des listes (ADR-004 §7.2)', () => {
  test('[TRI-01] notes à égalité de tri : départage par id, dans le sens du tri', async ({ org, apiAs }) => {
    const own = await insertTiedNotes(org.employee.id)
    const root = await insertTiedNotes(org.manager.id)

    const employee = await apiAs(org.employee)
    const ownIds = async (query?: Record<string, string>) =>
      (await employee.notes(query)).map((note) => note.id).filter((id) => own.includes(id))

    // Tri par défaut : created_at DESC, id DESC.
    expect(await ownIds()).toEqual(descending(own))
    for (const column of ['created_at', 'amount', 'expense_date', 'description', 'status']) {
      expect(await ownIds({ sort: `${column} ASC` }), `${column} ASC`).toEqual(own)
      expect(await ownIds({ sort: `${column} DESC` }), `${column} DESC`).toEqual(descending(own))
    }

    // Listes d'approbation : created_at ASC, id ASC.
    const manager = await apiAs(org.manager)
    expect((await manager.managerPending()).map((note) => note.id).filter((id) => own.includes(id))).toEqual(own)
    const hr = await apiAs(org.hr)
    expect((await hr.hrPending()).map((note) => note.id).filter((id) => root.includes(id))).toEqual(root)
  })

  test('[TRI-02] annuaire RH : homonymes départagés par id', async ({ org, apiAs }) => {
    const ids = sortedIds()
    const { rows } = await db().query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [org.employee.id])
    for (const index of SHUFFLE) {
      await db().query(
        `INSERT INTO users (id, company_id, name, email, password_hash, role)
         VALUES ($1, $2, 'Camille Homonyme', $3, $4, 'employee')`,
        [ids[index], org.company.id, `camille.${ids[index].slice(0, 8)}@${org.company.domain}`, rows[0].password_hash]
      )
    }

    const hr = await apiAs(org.hr)
    expect((await hr.hrUsers()).map((user) => user.id).filter((id) => ids.includes(id))).toEqual(ids)
  })
})
