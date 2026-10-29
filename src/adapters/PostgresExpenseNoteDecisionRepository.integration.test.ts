import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { PostgresExpenseNoteDecisionRepository } from './PostgresExpenseNoteDecisionRepository'
import { EXPENSE_NOTE_DECIDED } from '@/domain/Notification'
import { ExpenseNoteAlreadyDecided, ExpenseNoteNotVisible } from '@/domain/validation/DecideExpenseNote'
import { submitNote } from '../../integration/support/notes'
import { eventsOfNote } from '../../integration/support/outbox'
import { addMember, createTenant, owner } from '../../integration/support/tenant'

// Décision sous `expense_app` : verrou de la note, règle du domaine sur les
// faits lus en base, écriture gardée par `status = 'pending'` et événement
// « note tranchée » dans la même transaction.

const repository = new PostgresExpenseNoteDecisionRepository()

async function stored(noteId: string) {
  const result = await owner().query<{ status: string; decided_by: string | null; decided_at: Date | null }>(
    'SELECT status, decided_by, decided_at FROM expense_notes WHERE id = $1',
    [noteId]
  )
  return result.rows[0]
}

const decided = (events: Awaited<ReturnType<typeof eventsOfNote>>) =>
  events.filter((event) => event.type === EXPENSE_NOTE_DECIDED)

describe('manager', () => {
  it('approuve la note d’un subordonné direct : statut, auteur et date de la décision', async () => {
    const { employee, manager } = await createTenant('decision-approbation')
    const note = await submitNote(employee)
    const result = await repository.decide(note.id, manager.id, 'approved')
    expect(result).toMatchObject({ id: note.id, status: 'approved', user_id: employee.id })
    expect(await stored(note.id)).toMatchObject({ status: 'approved', decided_by: manager.id })
    expect((await stored(note.id)).decided_at).toBeInstanceOf(Date)
  })

  it('publie un seul événement « tranchée » pour l’auteur, dans la même transaction', async () => {
    const { employee, manager } = await createTenant('decision-evenement')
    const note = await submitNote(employee)
    await repository.decide(note.id, manager.id, 'rejected')
    expect(decided(await eventsOfNote(note.id))).toEqual([
      expect.objectContaining({
        companyId: employee.companyId,
        payload: expect.objectContaining({ noteId: note.id, decision: 'rejected', recipientIds: [employee.id] }),
      }),
    ])
  })

  it('une seconde décision lève ExpenseNoteAlreadyDecided et n’émet rien de plus', async () => {
    const { employee, manager } = await createTenant('decision-deja-tranchee')
    const note = await submitNote(employee)
    await repository.decide(note.id, manager.id, 'approved')
    await expect(repository.decide(note.id, manager.id, 'rejected')).rejects.toBeInstanceOf(ExpenseNoteAlreadyDecided)
    expect((await stored(note.id)).status).toBe('approved')
    expect(decided(await eventsOfNote(note.id))).toHaveLength(1)
  })

  it.each([
    ['sa propre note', 'own'],
    ['la note d’un N+2', 'indirect'],
    ['la note d’une autre équipe', 'otherTeam'],
    ['la note d’une autre entreprise', 'elsewhere'],
  ] as const)('refuse %s comme une note inexistante, statut inchangé', async (_label, situation) => {
    const tenant = await createTenant(`decision-${situation}`)
    const subManager = await addMember(tenant.company, { name: 'Nina Manager', role: 'manager', managerId: tenant.manager.id })
    const authors = {
      own: tenant.manager,
      indirect: await addMember(tenant.company, { name: 'Ivan Indirect', role: 'employee', managerId: subManager.id }),
      otherTeam: await addMember(tenant.company, {
        name: 'Theo Autre',
        role: 'employee',
        managerId: (await addMember(tenant.company, { name: 'Olga Racine', role: 'manager' })).id,
      }),
      elsewhere: (await createTenant(`decision-${situation}-b`)).employee,
    }
    const note = await submitNote(authors[situation])
    await expect(repository.decide(note.id, tenant.manager.id, 'approved')).rejects.toBeInstanceOf(ExpenseNoteNotVisible)
    expect((await stored(note.id)).status).toBe('pending')
  })

  it('un id inconnu ou un acteur inconnu : ExpenseNoteNotVisible', async () => {
    const { employee, manager } = await createTenant('decision-inconnu')
    const note = await submitNote(employee)
    await expect(repository.decide(randomUUID(), manager.id, 'approved')).rejects.toBeInstanceOf(ExpenseNoteNotVisible)
    await expect(repository.decide(note.id, randomUUID(), 'approved')).rejects.toBeInstanceOf(ExpenseNoteNotVisible)
  })

  it('deux décisions simultanées : une seule passe (verrou), un seul événement', async () => {
    const { employee, manager } = await createTenant('decision-concurrente')
    const note = await submitNote(employee)
    const outcomes = await Promise.allSettled([
      repository.decide(note.id, manager.id, 'approved'),
      repository.decide(note.id, manager.id, 'rejected'),
    ])
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    const [rejected] = outcomes.filter((outcome) => outcome.status === 'rejected')
    expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(ExpenseNoteAlreadyDecided)
    expect(decided(await eventsOfNote(note.id))).toHaveLength(1)
  })
})

describe('RH', () => {
  it('tranche la note d’un manager racine de son entreprise', async () => {
    const { hr, manager } = await createTenant('decision-rh')
    const note = await submitNote(manager)
    expect(await repository.decide(note.id, hr.id, 'approved')).toMatchObject({ status: 'approved' })
    expect(await stored(note.id)).toMatchObject({ status: 'approved', decided_by: hr.id })
  })

  it.each([
    ['d’un employé', 'employee'],
    ['d’un manager non racine', 'nonRoot'],
    ['d’un manager racine d’une autre entreprise', 'elsewhere'],
  ] as const)('refuse la note %s', async (_label, situation) => {
    const tenant = await createTenant(`decision-rh-${situation}`)
    const authors = {
      employee: tenant.employee,
      nonRoot: await addMember(tenant.company, { name: 'Nina Manager', role: 'manager', managerId: tenant.manager.id }),
      elsewhere: (await createTenant(`decision-rh-${situation}-b`)).manager,
    }
    const note = await submitNote(authors[situation])
    await expect(repository.decide(note.id, tenant.hr.id, 'approved')).rejects.toBeInstanceOf(ExpenseNoteNotVisible)
    expect((await stored(note.id)).status).toBe('pending')
  })

  it('un employé ne tranche rien, pas même sa propre note', async () => {
    const { employee } = await createTenant('decision-employe')
    const note = await submitNote(employee)
    await expect(repository.decide(note.id, employee.id, 'approved')).rejects.toBeInstanceOf(ExpenseNoteNotVisible)
  })
})
