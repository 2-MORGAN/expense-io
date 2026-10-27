import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { setUserContext } from '@/lib/db'
import { db, uniqueDomain } from './support/db'
import { createOrg, expect, test, type Org } from './support/fixtures'

// Isolation par la base (ADR-001 §5.1, ISO-07 ; 2-478). Chaque vérification
// s'exécute sous le rôle restreint `expense_app`, avec le contexte que pose
// `withUserScope`, dans une transaction annulée : rien n'est écrit. Les
// fixtures et les contrôles hors rôle passent par la connexion
// d'administration (`db()`). L'application, elle, ne bascule sur
// `expense_app` qu'avec 2-481.

/** Exécute `fn` sous `expense_app`, avec le contexte de `userId` s'il est donné, puis annule tout. */
async function asApp<T>(userId: string | null, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db().connect()
  try {
    await client.query('BEGIN')
    await client.query('SET LOCAL ROLE expense_app')
    if (userId) await setUserContext(client, userId)
    return await fn(client)
  } finally {
    await client.query('ROLLBACK')
    client.release()
  }
}

async function visibleNoteIds(client: PoolClient, ids: string[]): Promise<string[]> {
  const result = await client.query<{ id: string }>(
    'SELECT id FROM expense_notes WHERE id = ANY($1::uuid[]) ORDER BY id',
    [ids]
  )
  return result.rows.map((row) => row.id)
}

async function visibleUserIds(client: PoolClient, companyId: string): Promise<string[]> {
  const result = await client.query<{ id: string }>(
    'SELECT id FROM users WHERE company_id = $1 ORDER BY id',
    [companyId]
  )
  return result.rows.map((row) => row.id)
}

test.describe('Isolation par la base (RLS, rôle expense_app)', () => {
  let a: Org
  let b: Org
  let employeeNoteA: string
  let managerNoteA: string

  test.beforeEach(async ({ org, apiAs }) => {
    a = org
    b = await createOrg('iso-07-b')
    employeeNoteA = (await (await apiAs(a.employee)).submitNote()).id
    managerNoteA = (await (await apiAs(a.manager)).submitNote()).id
  })

  test('[ISO-07a] le rôle de l’application n’est ni superuser ni BYPASSRLS, sans accès aux mots de passe ni aux entreprises', async () => {
    const result = await db().query<{
      rolsuper: boolean
      rolbypassrls: boolean
      password_hash: boolean
      companies: boolean
    }>(
      `SELECT rolsuper, rolbypassrls,
              has_column_privilege('expense_app', 'users', 'password_hash', 'SELECT') AS password_hash,
              has_table_privilege('expense_app', 'companies', 'SELECT') AS companies
       FROM pg_roles WHERE rolname = 'expense_app'`
    )
    expect(result.rows).toEqual([
      { rolsuper: false, rolbypassrls: false, password_hash: false, companies: false },
    ])
    await expect(
      asApp(a.hr.id, (client) => client.query('SELECT password_hash FROM users'))
    ).rejects.toMatchObject({ code: '42501' })
  })

  test('[ISO-07b] contexte inconnu → 0 note', async () => {
    expect(await asApp(null, (client) => visibleNoteIds(client, [employeeNoteA, managerNoteA]))).toEqual([])
    expect(
      await asApp(randomUUID(), (client) => visibleNoteIds(client, [employeeNoteA, managerNoteA]))
    ).toEqual([])
  })

  test('[ISO-07c] contexte inconnu → 0 utilisateur', async () => {
    expect(await asApp(null, (client) => client.query('SELECT id FROM users'))).toMatchObject({ rowCount: 0 })
    expect(await asApp(randomUUID(), (client) => client.query('SELECT id FROM users'))).toMatchObject({
      rowCount: 0,
    })
  })

  test('[ISO-07d] RH de B → 0 note et 0 utilisateur de A ; la RH de A voit les siens', async () => {
    expect(await asApp(b.hr.id, (client) => visibleNoteIds(client, [employeeNoteA, managerNoteA]))).toEqual([])
    expect(await asApp(b.hr.id, (client) => visibleUserIds(client, a.company.id))).toEqual([])

    // Témoin : la même requête voit bien les données de sa propre entreprise.
    expect(await asApp(a.hr.id, (client) => visibleNoteIds(client, [employeeNoteA, managerNoteA]))).toEqual([
      managerNoteA,
    ])
    expect(await asApp(a.hr.id, (client) => visibleUserIds(client, a.company.id))).toEqual(
      [a.hr.id, a.manager.id, a.employee.id].sort()
    )
  })

  test('[ISO-07e] lien manager inter-entreprises : refusé par le schéma, et sans effet sur la visibilité', async () => {
    // Transaction annulée : sans la contrainte (schéma de `main`), le lien ne
    // doit pas survivre au test.
    const attempt = await db().connect()
    try {
      await attempt.query('BEGIN')
      await expect(
        attempt.query('UPDATE users SET manager_id = $1 WHERE id = $2', [b.manager.id, a.employee.id])
      ).rejects.toMatchObject({ code: '23503' })
    } finally {
      await attempt.query('ROLLBACK')
      attempt.release()
    }

    // Lien posé malgré tout (contrôles de clés étrangères désactivés dans la
    // transaction, comme un reliquat de S3) : le manager de B ne voit rien.
    const client = await db().connect()
    try {
      await client.query('BEGIN')
      await client.query("SET LOCAL session_replication_role = 'replica'")
      await client.query('UPDATE users SET manager_id = $1 WHERE id = $2', [b.manager.id, a.employee.id])
      await client.query('SET LOCAL ROLE expense_app')
      await setUserContext(client, b.manager.id)
      expect(await visibleNoteIds(client, [employeeNoteA])).toEqual([])
      const decided = await client.query("UPDATE expense_notes SET status = 'approved' WHERE id = $1", [
        employeeNoteA,
      ])
      expect(decided.rowCount).toBe(0)
    } finally {
      await client.query('ROLLBACK')
      client.release()
    }

    // Témoin : le manager de A voit la note de son employé.
    expect(await asApp(a.manager.id, (client) => visibleNoteIds(client, [employeeNoteA]))).toEqual([
      employeeNoteA,
    ])
  })

  test('[ISO-07f] un employé ne change pas le statut de sa propre note', async () => {
    const updated = await asApp(a.employee.id, (client) =>
      client.query("UPDATE expense_notes SET status = 'approved' WHERE id = $1", [employeeNoteA])
    )
    expect(updated.rowCount).toBe(0)
    const status = await db().query('SELECT status FROM expense_notes WHERE id = $1', [employeeNoteA])
    expect(status.rows[0]).toEqual({ status: 'pending' })
  })

  test('[ISO-07g] le manager racine trouve les RH de son entreprise, et seulement elles', async () => {
    const hrs = await asApp(a.manager.id, (client) =>
      client.query<{ id: string }>("SELECT id FROM users WHERE role = 'hr_admin'")
    )
    expect(hrs.rows).toEqual([{ id: a.hr.id }])
  })

  test('[ISO-07h] rattachement : la RH dans son entreprise seulement, jamais un employé', async () => {
    const detach = 'UPDATE users SET manager_id = NULL WHERE id = $1'
    expect(await asApp(a.hr.id, (client) => client.query(detach, [a.employee.id]))).toMatchObject({
      rowCount: 1,
    })
    expect(await asApp(a.hr.id, (client) => client.query(detach, [b.employee.id]))).toMatchObject({
      rowCount: 0,
    })
    expect(await asApp(a.employee.id, (client) => client.query(detach, [a.employee.id]))).toMatchObject({
      rowCount: 0,
    })
    await expect(
      asApp(a.hr.id, (client) =>
        client.query("UPDATE users SET role = 'hr_admin' WHERE id = $1", [a.employee.id])
      )
    ).rejects.toMatchObject({ code: '42501' })
  })

  test('[ISO-07i] connexion : auth_find_user rend une seule ligne, par email exact', async () => {
    const found = await asApp(null, (client) =>
      client.query<{ id: string; role: string }>('SELECT id, role FROM auth_find_user($1)', [a.hr.email])
    )
    expect(found.rows).toEqual([{ id: a.hr.id, role: 'hr_admin' }])
    const prefix = await asApp(null, (client) =>
      client.query('SELECT id FROM auth_find_user($1)', [a.hr.email.slice(0, -1)])
    )
    expect(prefix.rowCount).toBe(0)
  })

  test('[ISO-07j] le manager tranche la note de son équipe avec les écritures de la décision (statut, auteur, date)', async () => {
    // Mêmes requêtes que PostgresExpenseNoteDecisionRepository (2-488).
    const decided = await asApp(a.manager.id, async (client) => {
      await client.query('SELECT * FROM expense_notes WHERE id = $1 FOR UPDATE', [employeeNoteA])
      return client.query<{ status: string; decided_by: string }>(
        `UPDATE expense_notes SET status = $1, decided_by = $2, decided_at = now()
         WHERE id = $3 RETURNING status, decided_by`,
        ['approved', a.manager.id, employeeNoteA]
      )
    })
    expect(decided.rows).toEqual([{ status: 'approved', decided_by: a.manager.id }])
  })
})

test.describe('Inscription atomique (register_user)', () => {
  test('[SIGNUP-09] entreprise et RH créées ensemble ou pas du tout ; même domaine → deuxième entreprise', async ({
    org,
  }) => {
    const register = 'SELECT register_user($1, $2, $3, $4, $5) AS user_id'

    // Panne injectée : l'email existe déjà, l'insertion de la RH échoue après
    // celle de l'entreprise. Appel en autocommit, comme l'inscription : sans
    // atomicité, l'entreprise resterait sans RH.
    const failedDomain = uniqueDomain('signup-09-panne')
    const session = await db().connect()
    try {
      await session.query('SET ROLE expense_app')
      await expect(
        session.query(register, ['Doublon', org.hr.email, 'hash', 'panne', failedDomain])
      ).rejects.toMatchObject({ code: '23505' })
    } finally {
      await session.query('RESET ROLE')
      session.release()
    }
    const orphan = await db().query('SELECT 1 FROM companies WHERE email_domain = $1', [failedDomain])
    expect(orphan.rowCount).toBe(0)

    // Inscriptions réussies, dans une transaction annulée.
    const client = await db().connect()
    try {
      await client.query('BEGIN')
      await client.query('SET LOCAL ROLE expense_app')
      const domain = uniqueDomain('signup-09')
      const first = await client.query<{ user_id: string | null }>(register, [
        'Alice',
        `alice@${domain}`,
        'hash',
        'signup',
        domain,
      ])
      const second = await client.query<{ user_id: string | null }>(register, [
        'Bob',
        `bob@${domain}`,
        'hash',
        'signup',
        domain,
      ])
      expect(first.rows[0].user_id).toEqual(expect.any(String))
      // S7 (ADR-001 §3, 2-496) : le domaine ne regroupe plus personne, la
      // seconde inscription crée sa propre entreprise.
      expect(second.rows[0].user_id).toEqual(expect.any(String))

      await client.query('RESET ROLE')
      const companies = await client.query<{ company_id: string; role: string; email: string; verified: boolean }>(
        `SELECT c.id AS company_id, u.role, u.email, u.email_verified_at IS NOT NULL AS verified
         FROM companies c JOIN users u ON u.company_id = c.id
         WHERE c.email_domain = $1 ORDER BY u.email`,
        [domain]
      )
      expect(companies.rows).toEqual([
        { company_id: expect.any(String), role: 'hr_admin', email: `alice@${domain}`, verified: false },
        { company_id: expect.any(String), role: 'hr_admin', email: `bob@${domain}`, verified: false },
      ])
      expect(companies.rows[0].company_id).not.toBe(companies.rows[1].company_id)
      // Email de vérification demandé dans la même transaction.
      const events = await client.query(
        `SELECT 1 FROM outbox_events WHERE type = 'email.verification.requested'
         AND payload->>'userId' = ANY($1::text[])`,
        [[first.rows[0].user_id, second.rows[0].user_id]]
      )
      expect(events.rowCount).toBe(2)
    } finally {
      await client.query('ROLLBACK')
      client.release()
    }
  })
})
