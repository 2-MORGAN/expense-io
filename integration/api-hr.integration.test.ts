import { describe, expect, it, vi } from 'vitest'
import { POST as invite } from '@/app/api/hr/invitations/route'
import { PUT as assignManager } from '@/app/api/hr/users/[id]/manager/route'
import { GET as hrUsers } from '@/app/api/hr/users/route'
import type { CompanyUser } from '@/http/dto'
import { call, type CallOptions } from './support/api'
import { signInAs } from './support/auth'
import { addMember, createTenant, owner, type Tenant } from './support/tenant'

// Espace RH par les routes, dans le processus : annuaire, rattachement d'un
// manager (corps JSON validé par le contrat avant toute écriture, B7) et
// invitations (S7).
vi.mock('@/lib/auth', () => import('./support/auth'))

type Problem = { code: string }

const managerOf = async (userId: string) =>
  (await owner().query<{ manager_id: string | null }>('SELECT manager_id FROM users WHERE id = $1', [userId])).rows[0].manager_id

function assign(tenant: Tenant, userId: string, options: CallOptions) {
  signInAs(tenant.hr)
  return call<CompanyUser & Problem>(assignManager, 'PUT', `/api/hr/users/${userId}/manager`, { ...options, params: { id: userId } })
}

describe('GET /api/hr/users', () => {
  it('employés et managers de l’entreprise, triés par nom, au format du contrat', async () => {
    const tenant = await createTenant('api-annuaire')
    await createTenant('api-annuaire-autre')
    signInAs(tenant.hr)
    const { status, body } = await call<CompanyUser[]>(hrUsers, 'GET', '/api/hr/users')
    expect(status).toBe(200)
    expect(body).toEqual([
      { id: tenant.employee.id, name: 'Emile Employe', email: tenant.employee.email, role: 'employee', managerId: tenant.manager.id },
      { id: tenant.manager.id, name: 'Marie Manager', email: tenant.manager.email, role: 'manager', managerId: null },
    ])
  })
})

describe('PUT /api/hr/users/{id}/manager', () => {
  it('rattache puis détache (managerId: null), 200 avec l’utilisateur à jour', async () => {
    const tenant = await createTenant('api-rattachement')
    const other = await addMember(tenant.company, { name: 'Olga Racine', role: 'manager' })
    expect(await assign(tenant, tenant.employee.id, { json: { managerId: other.id } })).toMatchObject({
      status: 200,
      body: { id: tenant.employee.id, managerId: other.id },
    })
    expect(await assign(tenant, tenant.employee.id, { json: { managerId: null } })).toMatchObject({ status: 200, body: { managerId: null } })
    expect(await managerOf(tenant.employee.id)).toBeNull()
  })

  it.each([
    ['JSON malformé', { raw: '{pas du json' }, 'INVALID_JSON'],
    ['corps vide', { json: {} }, 'VALIDATION_ERROR'],
    ['managerId qui n’est pas un UUID', { json: { managerId: 'abc' } }, 'VALIDATION_ERROR'],
    ['corps qui n’est pas un objet', { json: [] }, 'VALIDATION_ERROR'],
  ] as const)('%s : 400 %s, jamais de détachement silencieux (B7)', async (_label, options, code) => {
    const tenant = await createTenant('api-rattachement-invalide')
    expect(await assign(tenant, tenant.employee.id, options)).toMatchObject({ status: 400, body: { code } })
    expect(await managerOf(tenant.employee.id)).toBe(tenant.manager.id)
  })

  it('manager d’une autre entreprise : 409 INVALID_MANAGER (S3) ; cible d’une autre entreprise : 404', async () => {
    const tenant = await createTenant('api-rattachement-s3')
    const other = await createTenant('api-rattachement-s3-b')
    expect(await assign(tenant, tenant.employee.id, { json: { managerId: other.manager.id } })).toMatchObject({
      status: 409,
      body: { code: 'INVALID_MANAGER' },
    })
    expect(await assign(tenant, other.employee.id, { json: { managerId: tenant.manager.id } })).toMatchObject({
      status: 404,
      body: { code: 'RESOURCE_NOT_FOUND' },
    })
    expect(await managerOf(other.employee.id)).toBe(other.manager.id)
  })
})

describe('POST /api/hr/invitations', () => {
  it('201 avec l’adresse normalisée ; relancer la même adresse rend la même invitation', async () => {
    const tenant = await createTenant('api-invitation')
    signInAs(tenant.hr)
    const email = `Nouvelle.Recrue@${tenant.company.domain.toUpperCase()}`
    const first = await call<{ id: string; email: string; expiresAt: string }>(invite, 'POST', '/api/hr/invitations', { json: { email } })
    expect(first).toMatchObject({ status: 201, body: { email: `nouvelle.recrue@${tenant.company.domain}` } })
    const again = await call<{ id: string }>(invite, 'POST', '/api/hr/invitations', { json: { email } })
    expect(again.body.id).toBe(first.body.id)
  })

  it.each([
    ['JSON malformé', { raw: '{' }, 'INVALID_JSON'],
    ['sans email', { json: {} }, 'VALIDATION_ERROR'],
    ['email non textuel', { json: { email: 42 } }, 'VALIDATION_ERROR'],
    ['adresse hors format', { json: { email: 'a..b@exemple.fr' } }, 'INVALID_EMAIL'],
  ] as const)('%s : 400 %s, aucune invitation', async (_label, options, code) => {
    const tenant = await createTenant('api-invitation-invalide')
    signInAs(tenant.hr)
    expect(await call<Problem>(invite, 'POST', '/api/hr/invitations', options)).toMatchObject({ status: 400, body: { code } })
    expect((await owner().query('SELECT 1 FROM invitations WHERE company_id = $1', [tenant.company.id])).rowCount).toBe(0)
  })
})
