import { beforeAll, describe, expect, it, vi } from 'vitest'
import { POST as hrApprove } from '@/app/api/hr/expense-notes/[id]/approve/route'
import { GET as hrReceipt } from '@/app/api/hr/expense-notes/[id]/receipt-url/route'
import { POST as hrReject } from '@/app/api/hr/expense-notes/[id]/reject/route'
import { GET as hrNotes } from '@/app/api/hr/expense-notes/route'
import { POST as invite } from '@/app/api/hr/invitations/route'
import { PUT as assignManager } from '@/app/api/hr/users/[id]/manager/route'
import { GET as hrUsers } from '@/app/api/hr/users/route'
import { GET as ownReceipt } from '@/app/api/expense-notes/[id]/receipt-url/route'
import { POST as suggest } from '@/app/api/expense-notes/receipt-suggestion/route'
import { GET as ownNotes, POST as submit } from '@/app/api/expense-notes/route'
import { POST as managerApprove } from '@/app/api/manager/expense-notes/[id]/approve/route'
import { GET as managerReceipt } from '@/app/api/manager/expense-notes/[id]/receipt-url/route'
import { POST as managerReject } from '@/app/api/manager/expense-notes/[id]/reject/route'
import { GET as managerNotes } from '@/app/api/manager/expense-notes/route'
import { GET as findAnalysis } from '@/app/api/receipt-analyses/[id]/route'
import { POST as launchAnalysis } from '@/app/api/receipt-analyses/route'
import { call, type CallOptions } from './support/api'
import { signInAs } from './support/auth'
import { submitNote } from './support/notes'
import { createTenant, owner, type Member, type Tenant } from './support/tenant'

// Contrôle d'accès des 17 opérations métier (ADR-004, Q1.1), handlers appelés
// dans le processus : 401 sans session, 403 rôle refusé, sinon la garde
// laisse passer (la réponse dépend alors de l'entrée). Chaque réponse est
// contrôlée contre le contrat, et un refus ne change rien en base. Pendant
// des E2E ACL-01 à ACL-04, sans serveur ni navigateur.
vi.mock('@/lib/auth', () => import('./support/auth'))

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000'

type Access = 'session' | 'manager' | 'hr_admin'

interface Operation {
  method: 'GET' | 'POST' | 'PUT'
  path: string
  handler: unknown
  access: Access
  /** Statut attendu quand la garde laisse passer, pour une requête sans effet de bord. */
  allowed: number
  /** Corps de cette requête : formulaire vide ou JSON. */
  body?: 'form' | { json: unknown }
  id?: boolean
}

// Pour les rôles autorisés : un id inconnu (404) ou une entrée invalide (400),
// jamais une écriture.
const OPERATIONS: Operation[] = [
  { method: 'GET', path: '/api/expense-notes', handler: ownNotes, access: 'session', allowed: 200 },
  { method: 'POST', path: '/api/expense-notes', handler: submit, access: 'session', body: 'form', allowed: 400 },
  { method: 'GET', path: '/api/expense-notes/{id}/receipt-url', handler: ownReceipt, access: 'session', id: true, allowed: 404 },
  { method: 'POST', path: '/api/expense-notes/receipt-suggestion', handler: suggest, access: 'session', body: 'form', allowed: 400 },
  { method: 'POST', path: '/api/receipt-analyses', handler: launchAnalysis, access: 'session', body: 'form', allowed: 400 },
  { method: 'GET', path: '/api/receipt-analyses/{id}', handler: findAnalysis, access: 'session', id: true, allowed: 404 },
  { method: 'GET', path: '/api/manager/expense-notes', handler: managerNotes, access: 'manager', allowed: 200 },
  { method: 'POST', path: '/api/manager/expense-notes/{id}/approve', handler: managerApprove, access: 'manager', id: true, allowed: 404 },
  { method: 'POST', path: '/api/manager/expense-notes/{id}/reject', handler: managerReject, access: 'manager', id: true, allowed: 404 },
  { method: 'GET', path: '/api/manager/expense-notes/{id}/receipt-url', handler: managerReceipt, access: 'manager', id: true, allowed: 404 },
  { method: 'GET', path: '/api/hr/expense-notes', handler: hrNotes, access: 'hr_admin', allowed: 200 },
  { method: 'POST', path: '/api/hr/expense-notes/{id}/approve', handler: hrApprove, access: 'hr_admin', id: true, allowed: 404 },
  { method: 'POST', path: '/api/hr/expense-notes/{id}/reject', handler: hrReject, access: 'hr_admin', id: true, allowed: 404 },
  { method: 'GET', path: '/api/hr/expense-notes/{id}/receipt-url', handler: hrReceipt, access: 'hr_admin', id: true, allowed: 404 },
  { method: 'GET', path: '/api/hr/users', handler: hrUsers, access: 'hr_admin', allowed: 200 },
  { method: 'PUT', path: '/api/hr/users/{id}/manager', handler: assignManager, access: 'hr_admin', id: true, body: { json: { managerId: null } }, allowed: 404 },
  { method: 'POST', path: '/api/hr/invitations', handler: invite, access: 'hr_admin', body: { json: {} }, allowed: 400 },
]

type Caller = 'anonyme' | 'employé' | 'manager' | 'RH'
const CALLERS: Caller[] = ['anonyme', 'employé', 'manager', 'RH']
const ROLE_OF: Record<Exclude<Caller, 'anonyme'>, Access> = { employé: 'session', manager: 'manager', RH: 'hr_admin' }

function expectedStatus(operation: Operation, caller: Caller): number {
  if (caller === 'anonyme') return 401
  if (operation.access === 'session' || operation.access === ROLE_OF[caller]) return operation.allowed
  return 403
}

let tenant: Tenant
let notes: { employee: string; manager: string }

/** Ce qu'un refus ne doit pas changer : statuts, rattachement, invitations, événements. */
async function snapshot() {
  const result = await owner().query(
    `SELECT
       (SELECT array_agg(status ORDER BY id) FROM expense_notes WHERE id = ANY($1::uuid[])) AS statuses,
       (SELECT manager_id FROM users WHERE id = $2) AS manager_id,
       (SELECT count(*)::int FROM invitations WHERE company_id = $3) AS invitations,
       (SELECT count(*)::int FROM outbox_events WHERE company_id = $3) AS events,
       (SELECT count(*)::int FROM expense_notes n JOIN users u ON u.id = n.user_id WHERE u.company_id = $3) AS notes`,
    [[notes.employee, notes.manager], tenant.employee.id, tenant.company.id]
  )
  return result.rows[0]
}

beforeAll(async () => {
  tenant = await createTenant('acces-api')
  notes = { employee: (await submitNote(tenant.employee)).id, manager: (await submitNote(tenant.manager)).id }
})

describe('garde de chaque opération', () => {
  const memberOf = (caller: Caller): Member | null =>
    ({ anonyme: null, employé: tenant.employee, manager: tenant.manager, RH: tenant.hr })[caller]

  it.each(OPERATIONS.flatMap((operation) => CALLERS.map((caller) => [`${operation.method} ${operation.path}`, caller, operation] as const)))(
    '%s, %s',
    async (_name, caller, operation) => {
      const before = await snapshot()
      signInAs(memberOf(caller))
      const path = operation.path.replace('{id}', UNKNOWN_ID)
      const status = expectedStatus(operation, caller)
      // Un formulaire ne se relit pas : un neuf par appel.
      const body: CallOptions = operation.body === 'form' ? { form: new FormData() } : { ...operation.body }
      const reply = await call<{ code?: string }>(operation.handler, operation.method, path, {
        ...body,
        params: operation.id ? { id: UNKNOWN_ID } : {},
      })
      expect(reply.status).toBe(status)
      if (status === 401) expect(reply.body.code).toBe('AUTHENTICATION_REQUIRED')
      if (status === 403) expect(reply.body.code).toBe('FORBIDDEN')
      expect(await snapshot()).toEqual(before)
    }
  )
})
