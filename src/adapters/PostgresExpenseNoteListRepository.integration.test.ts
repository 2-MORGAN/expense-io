import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { PostgresExpenseNoteListRepository } from './PostgresExpenseNoteListRepository'
import { SORTABLE_COLUMNS, type NoteSort } from '@/domain/expense/NoteSort'
import type { ListedExpenseNote } from '@/ports/ExpenseNoteListRepository'
import { decide, submitNote } from '../../integration/support/notes'
import { addMember, createTenant, type Member, type Tenant } from '../../integration/support/tenant'

// Les trois listes, contre la vraie base sous `expense_app` : la requête fixe
// de chaque tri et les critères du WHERE (subordonnés directs, managers
// racine), bornés en plus par la RLS à l'entreprise du lecteur.

const repository = new PostgresExpenseNoteListRepository()
const ids = (notes: ListedExpenseNote[]) => notes.map((note) => note.id)

describe('listOwn', () => {
  let tenant: Tenant
  let created: ListedExpenseNote[]

  beforeAll(async () => {
    tenant = await createTenant('liste-propre')
    // Créées dans cet ordre : created_at croissant. Montants, dates,
    // descriptions et statuts tous différents, en ASCII minuscule pour que
    // l'ordre ne dépende pas de la collation.
    const first = await submitNote(tenant.employee, { amount: 30, expenseDate: '2026-10-02', description: 'b-train' })
    const second = await submitNote(tenant.employee, { amount: 10, expenseDate: '2026-10-03', description: 'c-hotel' })
    const third = await submitNote(tenant.employee, { amount: 20, expenseDate: '2026-10-01', description: 'a-taxi' })
    await decide(first.id, tenant.manager, 'approved')
    await decide(third.id, tenant.manager, 'rejected')
    // Notes d'autres auteurs, jamais dans la liste de l'employé.
    await submitNote(tenant.manager)
    const colleague = await addMember(tenant.company, { name: 'Clara Collegue', role: 'employee', managerId: tenant.manager.id })
    await submitNote(colleague)
    created = [
      { ...first, status: 'approved' },
      second,
      { ...third, status: 'rejected' },
    ] as ListedExpenseNote[]
  })

  it('ne rend que les notes de l’auteur, plus récentes d’abord par défaut', async () => {
    const notes = await repository.listOwn(tenant.employee.id, 'created_at DESC')
    expect(ids(notes)).toEqual(ids(created).reverse())
    expect(notes.every((note) => note.user_id === tenant.employee.id)).toBe(true)
  })

  it('rend les colonnes telles que la base les donne : montant en chaîne, date YYYY-MM-DD', async () => {
    const [note] = await repository.listOwn(tenant.employee.id, 'amount ASC')
    expect(note).toMatchObject({ amount: '10.00', expense_date: '2026-10-03', description: 'c-hotel', status: 'pending' })
    expect(note.created_at).toBeInstanceOf(Date)
  })

  const value: Record<(typeof SORTABLE_COLUMNS)[number], (note: ListedExpenseNote, rank: number) => number | string> = {
    created_at: (_note, rank) => rank,
    amount: (note) => Number(note.amount),
    expense_date: (note) => note.expense_date,
    description: (note) => note.description,
    status: (note) => note.status,
  }

  it.each(SORTABLE_COLUMNS.flatMap((column) => (['ASC', 'DESC'] as const).map((direction) => `${column} ${direction}` as NoteSort)))(
    'trie par %s avec la requête fixe de la liste blanche',
    async (sort) => {
      const [column, direction] = sort.split(' ') as [(typeof SORTABLE_COLUMNS)[number], 'ASC' | 'DESC']
      const byKey = (a: { key: number | string }, b: { key: number | string }) => {
        if (a.key === b.key) return 0
        return a.key < b.key ? -1 : 1
      }
      const expected = created
        .map((note, rank) => ({ note, key: value[column](note, rank) }))
        .sort(byKey)
        .map(({ note }) => note.id)
      if (direction === 'DESC') expected.reverse()
      expect(ids(await repository.listOwn(tenant.employee.id, sort))).toEqual(expected)
    }
  )

  it('départage les notes identiques par id, dans le sens du tri', async () => {
    const twin = await createTenant('liste-jumelles')
    const notes = []
    for (let i = 0; i < 3; i++) notes.push(await submitNote(twin.employee, { amount: 5, expenseDate: '2026-10-05', description: 'meme' }))
    const byId = ids(notes as ListedExpenseNote[]).sort()
    expect(ids(await repository.listOwn(twin.employee.id, 'amount ASC'))).toEqual(byId)
    expect(ids(await repository.listOwn(twin.employee.id, 'amount DESC'))).toEqual([...byId].reverse())
  })

  it('ne rend rien pour un utilisateur inconnu (aucun contexte RLS)', async () => {
    expect(await repository.listOwn(randomUUID(), 'created_at DESC')).toEqual([])
  })
})

describe('listPendingForManager', () => {
  let tenant: Tenant
  let subManager: Member
  let expected: string[]
  let indirectNote: string

  beforeAll(async () => {
    tenant = await createTenant('liste-manager')
    const second = await addMember(tenant.company, { name: 'Bruno Equipe', role: 'employee', managerId: tenant.manager.id })
    subManager = await addMember(tenant.company, { name: 'Nina Manager', role: 'manager', managerId: tenant.manager.id })
    const indirect = await addMember(tenant.company, { name: 'Ivan Indirect', role: 'employee', managerId: subManager.id })
    const otherRoot = await addMember(tenant.company, { name: 'Olga Racine', role: 'manager' })
    const otherTeam = await addMember(tenant.company, { name: 'Theo Autre', role: 'employee', managerId: otherRoot.id })
    const elsewhere = await createTenant('liste-manager-b')

    const oldest = await submitNote(tenant.employee)
    const decided = await submitNote(tenant.employee)
    await decide(decided.id, tenant.manager, 'approved')
    const fromSubManager = await submitNote(subManager)
    indirectNote = (await submitNote(indirect)).id
    await submitNote(otherTeam)
    await submitNote(tenant.manager)
    await submitNote(elsewhere.employee)
    const newest = await submitNote(second)
    expected = [oldest.id, fromSubManager.id, newest.id]
  })

  it('rend les notes en attente des subordonnés directs, plus anciennes d’abord', async () => {
    expect(ids(await repository.listPendingForManager(tenant.manager.id))).toEqual(expected)
  })

  it('n’inclut ni N+2, ni autre équipe, ni ses propres notes, ni les notes tranchées', async () => {
    const notes = await repository.listPendingForManager(tenant.manager.id)
    expect(notes.every((note) => note.status === 'pending')).toBe(true)
    expect(notes.some((note) => note.user_id === tenant.manager.id)).toBe(false)
  })

  it('un manager intermédiaire voit son équipe, pas celle de son manager', async () => {
    expect(ids(await repository.listPendingForManager(subManager.id))).toEqual([indirectNote])
  })

  it('un employé n’a personne sous lui : liste vide', async () => {
    expect(await repository.listPendingForManager(tenant.employee.id)).toEqual([])
  })
})

describe('listPendingForHr', () => {
  let tenant: Tenant
  let expected: string[]

  beforeAll(async () => {
    tenant = await createTenant('liste-rh')
    const otherRoot = await addMember(tenant.company, { name: 'Olga Racine', role: 'manager' })
    const nonRoot = await addMember(tenant.company, { name: 'Nina Manager', role: 'manager', managerId: tenant.manager.id })
    const lonelyEmployee = await addMember(tenant.company, { name: 'Sam Seul', role: 'employee' })
    const elsewhere = await createTenant('liste-rh-b')

    const oldest = await submitNote(tenant.manager)
    const decided = await submitNote(tenant.manager)
    await decide(decided.id, tenant.hr, 'rejected')
    await submitNote(nonRoot)
    await submitNote(tenant.employee)
    await submitNote(lonelyEmployee)
    await submitNote(elsewhere.manager)
    const newest = await submitNote(otherRoot)
    expected = [oldest.id, newest.id]
  })

  it('rend les notes en attente des managers racine de son entreprise, plus anciennes d’abord', async () => {
    expect(ids(await repository.listPendingForHr(tenant.hr.id))).toEqual(expected)
  })

  it('la RH d’une autre entreprise ne voit aucune de ces notes', async () => {
    const elsewhere = await createTenant('liste-rh-c')
    const notes = await repository.listPendingForHr(elsewhere.hr.id)
    expect(notes.filter((note) => expected.includes(note.id))).toEqual([])
  })
})
