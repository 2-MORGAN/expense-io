import { beforeAll, expect } from 'vitest'
import { PostgresExpenseNoteListRepository } from '@/adapters/PostgresExpenseNoteListRepository'
import { PostgresReceiptAccessRepository } from '@/adapters/PostgresReceiptAccessRepository'
import { ExpenseNote } from '@/domain/ExpenseNote'
import { canViewReceipt } from '@/domain/expense/ReceiptAccess'
import { decideExpenseNote } from '@/domain/validation/DecideExpenseNote'
import { submitNote } from './notes'
import { addMember, createCompany, type Member } from './tenant'

// « Qui voit quoi » vit à deux endroits (CLAUDE.md, « Dette connue ») : dans
// le domaine pour une note (reçu : `canViewReceipt`, décision :
// `decideExpenseNote`) et dans le WHERE des listes
// (`PostgresExpenseNoteListRepository`), sans compter les policies RLS qui
// répètent ces critères. Cette matrice les confronte sur un même
// organigramme : pour chaque lecteur et chaque auteur, la note est dans la
// liste du lecteur ⟺ il en voit le reçu ⟺ il peut la trancher ⟺ ce que dit
// l'organigramme. Une règle qui change d'un côté sans l'autre fait échouer la
// case concernée.

export type Name = 'hrA' | 'm1' | 'm2' | 'm3' | 'e1' | 'e2' | 'e3' | 'e4' | 'hrB' | 'mB' | 'eB'

const VIEWERS: Name[] = ['m1', 'm2', 'm3', 'mB', 'hrA', 'hrB']
const AUTHORS: Name[] = ['e1', 'e2', 'e3', 'e4', 'm1', 'm2', 'm3', 'hrA', 'eB', 'mB']

/** Ce que dit l'organigramme, sans le code testé : la vérité attendue. */
function expected(viewer: Member, author: Member): boolean {
  if (viewer.companyId !== author.companyId) return false
  if (viewer.role === 'manager') return author.managerId === viewer.id
  return author.role === 'manager' && author.managerId === null
}

/**
 * Prépare l'organigramme (`beforeAll` du fichier appelant, avec la connexion
 * qu'il a configurée) et rend les 60 cases à passer à `it.each`, avec leur
 * vérification.
 */
export function visibilityMatrix(): { cases: (readonly [Name, Name])[]; check: (viewer: Name, author: Name) => Promise<void> } {
  const people = {} as Record<Name, Member>
  const noteOf = {} as Record<Name, string>
  const listed = {} as Record<Name, string[]>
  const lists = new PostgresExpenseNoteListRepository()
  const receipts = new PostgresReceiptAccessRepository()

  beforeAll(async () => {
    // Entreprise A : deux équipes de managers racine (m1, m3), un manager
    // intermédiaire (m2 sous m1), un employé sans manager (e3).
    const a = await createCompany('visibilite-a')
    people.hrA = await addMember(a, { name: 'Hugo Rh', role: 'hr_admin' })
    people.m1 = await addMember(a, { name: 'Marie Racine', role: 'manager' })
    people.m2 = await addMember(a, { name: 'Nina Intermediaire', role: 'manager', managerId: people.m1.id })
    people.m3 = await addMember(a, { name: 'Olga Racine', role: 'manager' })
    people.e1 = await addMember(a, { name: 'Emile Direct', role: 'employee', managerId: people.m1.id })
    people.e2 = await addMember(a, { name: 'Ivan Indirect', role: 'employee', managerId: people.m2.id })
    people.e3 = await addMember(a, { name: 'Sam Seul', role: 'employee' })
    people.e4 = await addMember(a, { name: 'Theo Autre', role: 'employee', managerId: people.m3.id })
    // Entreprise B : même forme, jamais visible depuis A.
    const b = await createCompany('visibilite-b')
    people.hrB = await addMember(b, { name: 'Hana Rh', role: 'hr_admin' })
    people.mB = await addMember(b, { name: 'Max Racine', role: 'manager' })
    people.eB = await addMember(b, { name: 'Eva Employe', role: 'employee', managerId: people.mB.id })

    for (const author of AUTHORS) noteOf[author] = (await submitNote(people[author])).id
    for (const viewer of VIEWERS) {
      const member = people[viewer]
      const notes = member.role === 'manager' ? await lists.listPendingForManager(member.id) : await lists.listPendingForHr(member.id)
      listed[viewer] = notes.map((note) => note.id)
    }
  })

  async function check(viewer: Name, author: Name): Promise<void> {
    const reader = people[viewer]
    const truth = expected(reader, people[author])
    const inList = listed[viewer].includes(noteOf[author])

    // Faits lus par l'adaptateur sous le contexte du lecteur.
    const access = await receipts.findReceipt(noteOf[author], reader.id)
    const scope = reader.role === 'manager' ? 'team' : 'company'
    const seesReceipt = access !== null && canViewReceipt(scope, access.viewer, access.submitter)
    let mayDecide = false
    if (access) {
      const pending = new ExpenseNote({
        id: noteOf[author],
        userId: access.submitter.id,
        amount: 42.5,
        expenseDate: '2026-10-01',
        description: 'matrice',
        receiptKey: access.receiptKey,
        status: 'pending',
      })
      try {
        decideExpenseNote(pending, access.submitter, access.viewer, 'approved')
        mayDecide = true
      } catch {
        mayDecide = false
      }
    }

    expect({ inList, seesReceipt, mayDecide }).toEqual({ inList: truth, seesReceipt: truth, mayDecide: truth })
  }

  return { cases: VIEWERS.flatMap((viewer) => AUTHORS.map((author) => [viewer, author] as const)), check }
}
