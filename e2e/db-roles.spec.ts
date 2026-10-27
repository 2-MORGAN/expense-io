import type { PoolClient } from 'pg'
import { setUserContext } from '@/lib/db'
import { scopeToCompany } from '@/lib/outbox'
import { db } from './support/db'
import { createOrg, expect, test, type Org } from './support/fixtures'
import { insertOutboxEvent } from './support/outbox'

// Bascule sur les rôles restreints (ADR-001 §3 point 7 et point de
// coordination avec l'ADR-003, 2-481). ISO-10 vérifie en base les droits du
// rôle du worker, sous `SET LOCAL ROLE`, dans une transaction annulée, comme
// ISO-07. ISO-11 vérifie que l'application et le worker lancés se connectent
// bien sous leurs rôles restreints.

const SET_ROLE = {
  expense_app: 'SET LOCAL ROLE expense_app',
  expense_worker: 'SET LOCAL ROLE expense_worker',
} as const

/** Exécute `fn` sous `role`, puis annule tout. */
async function asRole<T>(role: keyof typeof SET_ROLE, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db().connect()
  try {
    await client.query('BEGIN')
    await client.query(SET_ROLE[role])
    return await fn(client)
  } finally {
    await client.query('ROLLBACK')
    client.release()
  }
}

test.describe('Rôle du worker (expense_worker)', () => {
  let a: Org
  let b: Org

  test.beforeEach(async ({ org }) => {
    a = org
    b = await createOrg('iso-10-b')
  })

  test('[ISO-10a] le rôle du worker n’est ni superuser ni BYPASSRLS, sans accès aux mots de passe, aux entreprises ni aux notes', async () => {
    const result = await db().query(
      `SELECT rolsuper, rolbypassrls, rolcanlogin,
              has_column_privilege('expense_worker', 'users', 'password_hash', 'SELECT') AS password_hash,
              has_table_privilege('expense_worker', 'companies', 'SELECT') AS companies,
              has_table_privilege('expense_worker', 'expense_notes', 'SELECT') AS expense_notes,
              has_table_privilege('expense_worker', 'outbox_events', 'INSERT') AS outbox_insert
       FROM pg_roles WHERE rolname = 'expense_worker'`
    )
    expect(result.rows).toEqual([{
      rolsuper: false,
      rolbypassrls: false,
      rolcanlogin: true,
      password_hash: false,
      companies: false,
      expense_notes: false,
      outbox_insert: false,
    }])
  })

  test('[ISO-10b] le worker traite l’outbox de toutes les entreprises, mais ne lit les utilisateurs que dans l’entreprise posée', async () => {
    const type = `test.iso-10b.${a.company.id}`
    const ids = [
      await insertOutboxEvent({ companyId: a.company.id, type }),
      await insertOutboxEvent({ companyId: b.company.id, type }),
    ].sort()

    await asRole('expense_worker', async (client) => {
      const visible = await client.query<{ id: string }>(
        'SELECT id FROM outbox_events WHERE type = $1 ORDER BY id',
        [type]
      )
      expect(visible.rows.map((row) => row.id)).toEqual(ids)
      const sent = await client.query("UPDATE outbox_events SET status = 'sent' WHERE type = $1", [type])
      expect(sent.rowCount).toBe(2)

      const companyUsers = (companyId: string) =>
        client.query('SELECT id FROM users WHERE company_id = $1', [companyId]).then((r) => r.rowCount)
      // Sans contexte : aucun utilisateur.
      expect(await companyUsers(a.company.id)).toBe(0)
      // Entreprise de l'événement posée (`scopeToCompany`) : la sienne seulement.
      await scopeToCompany(client, a.company.id)
      expect(await companyUsers(a.company.id)).toBe(3)
      expect(await companyUsers(b.company.id)).toBe(0)
    })
  })

  test('[ISO-10c] l’application n’écrit un événement que dans l’entreprise de l’utilisateur courant', async () => {
    const insert = 'INSERT INTO outbox_events (company_id, type, payload) VALUES ($1, $2, $3)'
    await asRole('expense_app', async (client) => {
      await setUserContext(client, a.employee.id)
      // Témoin : sa propre entreprise.
      await expect(client.query(insert, [a.company.id, 'test.iso-10c', '{}'])).resolves.toMatchObject({ rowCount: 1 })
      await client.query('SAVEPOINT other_company')
      await expect(client.query(insert, [b.company.id, 'test.iso-10c', '{}'])).rejects.toMatchObject({ code: '42501' })
      await client.query('ROLLBACK TO SAVEPOINT other_company')
      // Ni lecture ni mise à jour de l'outbox pour l'application.
      await expect(client.query('SELECT id FROM outbox_events')).rejects.toMatchObject({ code: '42501' })
    })
  })

  test('[ISO-10d] les lectures multi-entreprises passent par des fonctions réservées au worker', async () => {
    const calls = [
      'SELECT * FROM receipt_cleanup_candidates(1)',
      'SELECT purge_expired_receipt_analyses()',
      "SELECT * FROM referenced_receipt_keys(ARRAY['receipts/none'])",
    ]
    for (const call of calls) {
      await asRole('expense_worker', async (client) => {
        await expect(client.query(call)).resolves.toBeDefined()
      })
      await asRole('expense_app', async (client) => {
        await expect(client.query(call)).rejects.toMatchObject({ code: '42501' })
      })
    }
    // Garde-fou de capacité de l'OCR : l'application ne lit que le nombre
    // d'analyses en attente, toutes entreprises.
    await asRole('expense_app', async (client) => {
      const pending = await client.query<{ count: string }>('SELECT pending_receipt_analyses() AS count')
      expect(Number(pending.rows[0].count)).toBeGreaterThanOrEqual(0)
    })
  })
})

test('[ISO-11] l’application et le worker lancés se connectent sous expense_app et expense_worker', async ({ org, apiAs }) => {
  // Une requête authentifiée ouvre des connexions de l'application ; le
  // worker interroge l'outbox en continu.
  await (await apiAs(org.employee)).notes()

  await expect(async () => {
    const result = await db().query<{ application_name: string; usename: string }>(
      `SELECT DISTINCT application_name, usename FROM pg_stat_activity
       WHERE datname = current_database() AND application_name IN ('expense-web', 'expense-worker')
       ORDER BY application_name`
    )
    expect(result.rows).toEqual([
      { application_name: 'expense-web', usename: 'expense_app' },
      { application_name: 'expense-worker', usename: 'expense_worker' },
    ])
  }).toPass({ timeout: 15_000 })
})
