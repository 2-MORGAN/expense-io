import { randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { Pool } from 'pg'
import { databaseUrl } from './env'

// Préparation des données de test.
//
// Seule dépendance des tests au schéma SQL : les tables `companies` et
// `users`, exactement comme `scripts/seed.mjs` (le rôle `manager` ne
// s'attribue que par seed/base, il n'existe aucun parcours UI/API pour ça).
// Les notes de frais, elles, sont TOUJOURS créées et tranchées via l'API,
// pour ne pas figer le schéma de `expense_notes` dans les tests.

export type Role = 'employee' | 'manager' | 'hr_admin'

export interface Company {
  id: string
  name: string
  domain: string
}

export interface TestUser {
  id: string
  name: string
  email: string
  password: string
  role: Role
  companyId: string
}

/** Tous les domaines créés par les tests finissent par ce suffixe. */
export const E2E_DOMAIN_SUFFIX = '.e2e.test'

/** Mot de passe commun des comptes créés par les fixtures (≥ 8 caractères). */
export const TEST_PASSWORD = 'e2e-mot-de-passe'

// Coût bcrypt réduit pour la rapidité : `bcrypt.compare` lit le coût dans le
// hash, la connexion applicative fonctionne à l'identique.
const TEST_PASSWORD_HASH = bcrypt.hashSync(TEST_PASSWORD, 4)

let pool: Pool | undefined

export function db(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: databaseUrl(), max: 4 })
  }
  return pool
}

export async function closeDb(): Promise<void> {
  await pool?.end()
  pool = undefined
}

function slugify(value: string): string {
  return (
    value
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || 'x'
  )
}

/** Domaine email unique, reconnaissable et purgeable (`<label>-<aléa>.e2e.test`). */
export function uniqueDomain(label: string): string {
  return `${slugify(label)}-${randomUUID().slice(0, 8)}${E2E_DOMAIN_SUFFIX}`
}

/** Crée une entreprise comme le ferait le premier signup sur ce domaine. */
export async function createCompany(label: string): Promise<Company> {
  const domain = uniqueDomain(label)
  const name = domain.split('.')[0]
  const result = await db().query<{ id: string }>(
    'INSERT INTO companies (name, email_domain) VALUES ($1, $2) RETURNING id',
    [name, domain]
  )
  return { id: result.rows[0].id, name, domain }
}

export async function createUser(
  company: Company,
  input: { name: string; role: Role; managerId?: string | null }
): Promise<TestUser> {
  const email = `${slugify(input.name).replace(/-/g, '.')}.${randomUUID().slice(0, 4)}@${company.domain}`
  const result = await db().query<{ id: string }>(
    `INSERT INTO users (company_id, name, email, password_hash, role, manager_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [company.id, input.name, email, TEST_PASSWORD_HASH, input.role, input.managerId ?? null]
  )
  return {
    id: result.rows[0].id,
    name: input.name,
    email,
    password: TEST_PASSWORD,
    role: input.role,
    companyId: company.id,
  }
}

/** Promotion manager : opération documentée « seed ou base uniquement ». */
export async function setRole(userId: string, role: Role): Promise<void> {
  await db().query('UPDATE users SET role = $1 WHERE id = $2', [role, userId])
}

export async function findUserByEmail(
  email: string
): Promise<{ id: string; role: Role; companyId: string; managerId: string | null } | null> {
  const result = await db().query<{
    id: string
    role: Role
    company_id: string
    manager_id: string | null
  }>('SELECT id, role, company_id, manager_id FROM users WHERE email = $1', [email])
  const row = result.rows[0]
  return row
    ? { id: row.id, role: row.role, companyId: row.company_id, managerId: row.manager_id }
    : null
}

export async function findCompanyByDomain(
  domain: string
): Promise<{ id: string; name: string } | null> {
  const result = await db().query<{ id: string; name: string }>(
    'SELECT id, name FROM companies WHERE email_domain = $1',
    [domain]
  )
  return result.rows[0] ?? null
}

/**
 * Supprime les données laissées par une exécution précédente (domaines
 * `*.e2e.test` uniquement). Best effort : un échec est signalé mais ne bloque
 * pas la suite (les données de test n'interfèrent pas entre exécutions).
 */
export async function purgeE2eData(): Promise<number> {
  const client = await db().connect()
  try {
    await client.query('BEGIN')
    const companies = await client.query<{ id: string }>(
      'SELECT id FROM companies WHERE email_domain LIKE $1',
      [`%${E2E_DOMAIN_SUFFIX}`]
    )
    const companyIds = companies.rows.map((row) => row.id)
    if (companyIds.length > 0) {
      await client.query(
        `DELETE FROM expense_notes
         WHERE user_id IN (SELECT id FROM users WHERE company_id = ANY($1::uuid[]))`,
        [companyIds]
      )
      await client.query(
        `UPDATE users SET manager_id = NULL
         WHERE manager_id IN (SELECT id FROM users WHERE company_id = ANY($1::uuid[]))`,
        [companyIds]
      )
      await client.query('DELETE FROM users WHERE company_id = ANY($1::uuid[])', [companyIds])
      await client.query('DELETE FROM companies WHERE id = ANY($1::uuid[])', [companyIds])
    }
    await client.query('COMMIT')
    return companyIds.length
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
