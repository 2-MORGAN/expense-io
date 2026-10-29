import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { PostgresExpenseNoteSubmissionRepository } from './PostgresExpenseNoteSubmissionRepository'
import { EXPENSE_NOTE_SUBMITTED } from '@/modules/expenses/domain/Notification'
import { DuplicateIdempotencyKey, type NewExpenseNote } from '@/modules/expenses/ports/ExpenseNoteSubmissionRepository'
import { eventsOfNote } from '../../../../integration/support/outbox'
import { addMember, createTenant, owner, type Member } from '../../../../integration/support/tenant'

// Écriture d'une note sous `expense_app` : insertion soumise à la RLS, et
// « note soumise » publiée dans la même transaction pour chaque approbateur
// (outbox, 2-484).

const repository = new PostgresExpenseNoteSubmissionRepository()

function newNote(author: Member, overrides: Partial<NewExpenseNote> = {}): NewExpenseNote {
  const id = randomUUID()
  return {
    id,
    amount: 42.5,
    expenseDate: '2026-10-01',
    description: 'Taxi aéroport',
    receiptKey: `receipts/${author.companyId}/${id}.png`,
    ...overrides,
  }
}

describe('create', () => {
  it('insère la note en attente et la rend telle que la base la stocke', async () => {
    const { employee } = await createTenant('soumission')
    const note = newNote(employee)
    const created = await repository.create(employee.id, note)
    expect(created).toMatchObject({
      id: note.id,
      user_id: employee.id,
      amount: '42.50',
      expense_date: '2026-10-01',
      description: 'Taxi aéroport',
      receipt_key: note.receiptKey,
      status: 'pending',
    })
  })

  it('publie un événement pour le manager direct de l’employé, dans la même transaction', async () => {
    const { employee, manager } = await createTenant('soumission-evenement')
    const note = await repository.create(employee.id, newNote(employee))
    const events = await eventsOfNote(note.id)
    expect(events).toHaveLength(1)
    // Statut non vérifié : un worker lancé sur la même base (`make dev`) peut
    // déjà l'avoir envoyé (ADR-003 §5, comme les E2E).
    expect(events[0]).toMatchObject({
      type: EXPENSE_NOTE_SUBMITTED,
      companyId: employee.companyId,
      payload: { noteId: note.id, recipientIds: [manager.id], submitterName: 'Emile Employe' },
    })
  })

  it('manager racine : un événement par RH de son entreprise, chacun avec un seul destinataire', async () => {
    const tenant = await createTenant('soumission-racine')
    const secondHr = await addMember(tenant.company, { name: 'Helene Rh', role: 'hr_admin' })
    const note = await repository.create(tenant.manager.id, newNote(tenant.manager))
    // Même transaction, donc même created_at : l'ordre des deux lignes n'est pas garanti.
    const recipients = (await eventsOfNote(note.id)).map((event) => event.payload.recipientIds as string[])
    expect(recipients.sort((a, b) => a[0].localeCompare(b[0]))).toEqual([[tenant.hr.id], [secondHr.id]].sort((a, b) => a[0].localeCompare(b[0])))
  })

  it('soumetteur sans approbateur (employé sans manager, RH) : la note existe, aucun événement', async () => {
    const tenant = await createTenant('soumission-sans-approbateur')
    const alone = await addMember(tenant.company, { name: 'Sam Seul', role: 'employee' })
    for (const author of [alone, tenant.hr]) {
      const note = await repository.create(author.id, newNote(author))
      expect(note.status).toBe('pending')
      expect(await eventsOfNote(note.id)).toEqual([])
    }
  })

  it('refuse une clé de reçu vide, sans laisser de note ni d’événement (contrainte de 2-476)', async () => {
    const { employee } = await createTenant('soumission-sans-recu')
    const note = newNote(employee, { receiptKey: '' })
    await expect(repository.create(employee.id, note)).rejects.toMatchObject({ code: '23514' })
    expect(await repository.find(employee.id, note.id)).toBeNull()
    expect(await eventsOfNote(note.id)).toEqual([])
  })

  it('un montant hors de numeric(10, 2) échoue en base, transaction annulée', async () => {
    const { employee } = await createTenant('soumission-debordement')
    const note = newNote(employee, { amount: 1e10 })
    await expect(repository.create(employee.id, note)).rejects.toMatchObject({ code: '22003' })
    expect(await owner().query('SELECT 1 FROM expense_notes WHERE id = $1', [note.id])).toMatchObject({ rowCount: 0 })
  })
})

describe('Idempotency-Key', () => {
  it('une clé déjà prise par l’utilisateur lève DuplicateIdempotencyKey, sans seconde note', async () => {
    const { employee } = await createTenant('idempotence')
    const key = randomUUID()
    const first = await repository.create(employee.id, newNote(employee, { idempotency: { key, fingerprint: 'a' } }))
    await expect(
      repository.create(employee.id, newNote(employee, { idempotency: { key, fingerprint: 'a' } }))
    ).rejects.toBeInstanceOf(DuplicateIdempotencyKey)
    expect((await repository.findByIdempotencyKey(employee.id, key))?.id).toBe(first.id)
  })

  it('la clé est propre à l’utilisateur : un collègue peut réutiliser la même', async () => {
    const tenant = await createTenant('idempotence-collegue')
    const colleague = await addMember(tenant.company, { name: 'Clara Collegue', role: 'employee', managerId: tenant.manager.id })
    const key = randomUUID()
    await repository.create(tenant.employee.id, newNote(tenant.employee, { idempotency: { key, fingerprint: 'a' } }))
    const other = await repository.create(colleague.id, newNote(colleague, { idempotency: { key, fingerprint: 'b' } }))
    expect(other.user_id).toBe(colleague.id)
    expect(other.request_fingerprint).toBe('b')
  })

  it('findByIdempotencyKey ne rend pas la note d’un autre utilisateur', async () => {
    const { employee, manager } = await createTenant('idempotence-lecture')
    const key = randomUUID()
    await repository.create(employee.id, newNote(employee, { idempotency: { key, fingerprint: 'a' } }))
    expect(await repository.findByIdempotencyKey(manager.id, key)).toBeNull()
  })
})

describe('lectures', () => {
  it('find rend sa propre note, jamais celle d’un autre, même son manager', async () => {
    const { employee, manager } = await createTenant('lecture-note')
    const note = await repository.create(employee.id, newNote(employee))
    expect((await repository.find(employee.id, note.id))?.id).toBe(note.id)
    expect(await repository.find(manager.id, note.id)).toBeNull()
  })

  it('companyIdOf lit l’entreprise en base ; un utilisateur inconnu est une erreur', async () => {
    const { employee } = await createTenant('lecture-entreprise')
    expect(await repository.companyIdOf(employee.id)).toBe(employee.companyId)
    await expect(repository.companyIdOf(randomUUID())).rejects.toThrow('Unknown user')
  })
})
