import { describe, expect, it, vi } from 'vitest'
import { POST as hrApprove } from '@/app/api/hr/expense-notes/[id]/approve/route'
import { POST as hrReject } from '@/app/api/hr/expense-notes/[id]/reject/route'
import { GET as hrNotes } from '@/app/api/hr/expense-notes/route'
import { POST as managerApprove } from '@/app/api/manager/expense-notes/[id]/approve/route'
import { POST as managerReject } from '@/app/api/manager/expense-notes/[id]/reject/route'
import { GET as managerNotes } from '@/app/api/manager/expense-notes/route'
import { EXPENSE_NOTE_DECIDED } from '@/domain/Notification'
import type { ExpenseNote } from '@/http/dto'
import { call } from './support/api'
import { signInAs } from './support/auth'
import { submitNote } from './support/notes'
import { eventsOfNote } from './support/outbox'
import { addMember, createTenant, type Member } from './support/tenant'

// Les quatre routes de décision et les deux listes d'attente, dans le
// processus : garde, validation de l'id, cas d'usage, verrou et événement en
// base, traduction des erreurs du domaine en 404 et 409 au format du contrat.
vi.mock('@/lib/auth', () => import('./support/auth'))

type Problem = { code: string; error: string }

function decide(handler: unknown, scope: 'manager' | 'hr', verb: 'approve' | 'reject', noteId: string, actor: Member) {
  signInAs(actor)
  return call<ExpenseNote & Problem>(handler, 'POST', `/api/${scope}/expense-notes/${noteId}/${verb}`, { params: { id: noteId } })
}

describe('manager', () => {
  it('approuve : 200 et la note du contrat ; la liste d’attente ne la montre plus ; l’auteur est prévenu', async () => {
    const tenant = await createTenant('api-decision')
    const note = await submitNote(tenant.employee)
    signInAs(tenant.manager)
    expect((await call<ExpenseNote[]>(managerNotes, 'GET', '/api/manager/expense-notes')).body.map((n) => n.id)).toEqual([note.id])

    const reply = await decide(managerApprove, 'manager', 'approve', note.id, tenant.manager)
    expect(reply).toMatchObject({ status: 200, body: { id: note.id, status: 'approved', userId: tenant.employee.id } })
    signInAs(tenant.manager)
    expect((await call<ExpenseNote[]>(managerNotes, 'GET', '/api/manager/expense-notes')).body).toEqual([])
    expect((await eventsOfNote(note.id)).filter((event) => event.type === EXPENSE_NOTE_DECIDED)).toHaveLength(1)
  })

  it('une note déjà tranchée : 409 ALREADY_DECIDED, champ « error » historique préservé', async () => {
    const tenant = await createTenant('api-decision-409')
    const note = await submitNote(tenant.employee)
    await decide(managerReject, 'manager', 'reject', note.id, tenant.manager)
    expect(await decide(managerApprove, 'manager', 'approve', note.id, tenant.manager)).toMatchObject({
      status: 409,
      body: { code: 'ALREADY_DECIDED', error: 'Already decided' },
    })
  })

  it('note d’une autre équipe : 404 RESOURCE_NOT_FOUND, comme un id inconnu', async () => {
    const tenant = await createTenant('api-decision-404')
    const otherManager = await addMember(tenant.company, { name: 'Olga Racine', role: 'manager' })
    const note = await submitNote(tenant.employee)
    expect(await decide(managerApprove, 'manager', 'approve', note.id, otherManager)).toMatchObject({
      status: 404,
      body: { code: 'RESOURCE_NOT_FOUND', error: 'Not found' },
    })
  })

  it('id de chemin qui n’est pas un UUID : 400 VALIDATION_ERROR', async () => {
    const tenant = await createTenant('api-decision-uuid')
    signInAs(tenant.manager)
    expect(
      await call(managerApprove, 'POST', '/api/manager/expense-notes/42/approve', { params: { id: '42' } })
    ).toMatchObject({ status: 400, body: { code: 'VALIDATION_ERROR' } })
  })
})

describe('RH', () => {
  it('tranche la note d’un manager racine ; la note d’un employé lui est invisible (404)', async () => {
    const tenant = await createTenant('api-decision-rh')
    const rootNote = await submitNote(tenant.manager)
    const employeeNote = await submitNote(tenant.employee)
    signInAs(tenant.hr)
    expect((await call<ExpenseNote[]>(hrNotes, 'GET', '/api/hr/expense-notes')).body.map((n) => n.id)).toEqual([rootNote.id])
    expect(await decide(hrApprove, 'hr', 'approve', rootNote.id, tenant.hr)).toMatchObject({ status: 200, body: { status: 'approved' } })
    expect(await decide(hrReject, 'hr', 'reject', employeeNote.id, tenant.hr)).toMatchObject({ status: 404 })
  })

  it('la RH d’une autre entreprise ne tranche pas (404), la note reste en attente', async () => {
    const tenant = await createTenant('api-decision-rh-a')
    const other = await createTenant('api-decision-rh-b')
    const note = await submitNote(tenant.manager)
    expect(await decide(hrApprove, 'hr', 'approve', note.id, other.hr)).toMatchObject({ status: 404 })
    expect(await decide(hrApprove, 'hr', 'approve', note.id, tenant.hr)).toMatchObject({ status: 200 })
  })
})
