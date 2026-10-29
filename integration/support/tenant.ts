import { randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { Pool, type PoolClient } from 'pg'
import { OWNER_DATABASE_URL } from './env'

// Données des tests d'intégration : une entreprise par test, sous un domaine
// unique `*.integration.test`, créée sous le rôle propriétaire comme le fait
// `scripts/seed.mjs` (le rôle manager ne s'attribue qu'en base). Le code testé,
// lui, tourne sous `expense_app` : la RLS s'applique à tout ce qu'il lit.

export const TENANT_DOMAIN_SUFFIX = '.integration.test'

/** Mot de passe commun des comptes de test (≥ 8 caractères). */
export const TEST_PASSWORD = 'integration-mot-de-passe'

// Coût bcrypt réduit : `bcrypt.compare` lit le coût dans le hash.
const TEST_PASSWORD_HASH = bcrypt.hashSync(TEST_PASSWORD, 4)

export type Role = 'employee' | 'manager' | 'hr_admin'

export interface Company {
  id: string
  name: string
  domain: string
}

export interface Member {
  id: string
  name: string
  email: string
  role: Role
  companyId: string
  managerId: string | null
}

/** Entreprise de référence : une RH, un manager racine et un employé rattaché à ce manager. */
export interface Tenant {
  company: Company
  hr: Member
  manager: Member
  employee: Member
}

let pool: Pool | undefined

/** Connexion propriétaire, hors RLS : préparer et vérifier les données, jamais pour le code testé. */
export function owner(): Pool {
  pool ??= new Pool({ connectionString: OWNER_DATABASE_URL, max: 4, application_name: 'expense-integration-owner' })
  return pool
}

export async function closeOwner(): Promise<void> {
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
      .replace(/^-|-$/g, '')
      .slice(0, 24) || 'x'
  )
}

export async function createCompany(label: string): Promise<Company> {
  const domain = `${slugify(label)}-${randomUUID().slice(0, 8)}${TENANT_DOMAIN_SUFFIX}`
  const name = domain.split('.')[0]
  const result = await owner().query<{ id: string }>(
    'INSERT INTO companies (name, email_domain) VALUES ($1, $2) RETURNING id',
    [name, domain]
  )
  return { id: result.rows[0].id, name, domain }
}

export async function addMember(
  company: Company,
  input: { name: string; role: Role; managerId?: string | null; verified?: boolean }
): Promise<Member> {
  const email = `${slugify(input.name).replace(/-/g, '.')}.${randomUUID().slice(0, 6)}@${company.domain}`
  const managerId = input.managerId ?? null
  const result = await owner().query<{ id: string }>(
    `INSERT INTO users (company_id, name, email, password_hash, role, manager_id, email_verified_at)
     VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $7::boolean THEN now() END)
     RETURNING id`,
    [company.id, input.name, email, TEST_PASSWORD_HASH, input.role, managerId, input.verified ?? true]
  )
  return { id: result.rows[0].id, name: input.name, email, role: input.role, companyId: company.id, managerId }
}

export async function createTenant(label: string): Promise<Tenant> {
  const company = await createCompany(label)
  const hr = await addMember(company, { name: 'Hugo Rh', role: 'hr_admin' })
  const manager = await addMember(company, { name: 'Marie Manager', role: 'manager' })
  const employee = await addMember(company, { name: 'Emile Employe', role: 'employee', managerId: manager.id })
  return { company, hr, manager, employee }
}

/** Exécute `fn` dans une transaction propriétaire, validée sauf erreur. */
export async function asOwner<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await owner().connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

/**
 * Supprime les entreprises `*.integration.test` d'une exécution précédente et
 * tout ce qui les référence (outbox et analyses suivent en cascade).
 */
export async function purgeTenants(): Promise<number> {
  return asOwner(async (client) => {
    const companies = await client.query<{ id: string }>('SELECT id FROM companies WHERE email_domain LIKE $1', [
      `%${TENANT_DOMAIN_SUFFIX}`,
    ])
    const ids = companies.rows.map((row) => row.id)
    if (ids.length === 0) return 0
    await client.query(
      'DELETE FROM expense_notes WHERE user_id IN (SELECT id FROM users WHERE company_id = ANY($1::uuid[]))',
      [ids]
    )
    await client.query('DELETE FROM invitations WHERE company_id = ANY($1::uuid[])', [ids])
    await client.query(
      'UPDATE users SET manager_id = NULL WHERE manager_id IN (SELECT id FROM users WHERE company_id = ANY($1::uuid[]))',
      [ids]
    )
    await client.query('DELETE FROM users WHERE company_id = ANY($1::uuid[])', [ids])
    await client.query('DELETE FROM companies WHERE id = ANY($1::uuid[])', [ids])
    return ids.length
  })
}
