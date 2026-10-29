import { ExpenseNote } from '@/modules/expenses/domain/ExpenseNote'
import type { UserRole } from '@/modules/identity/domain/User'

// Règle « valider ou rejeter une note » (WS2) : pure, sans base ni HTTP.
// Cœur du module Expense (avec ExpenseNote, ReceiptAccess, NoteSort).
// Figée à l'identique du comportement actuel des 4 routes :
// - manager : notes des subordonnés directs (submitter.managerId = acteur),
// - RH : notes des managers racine de sa propre entreprise,
// - seulement si la note est en attente.

export type Decision = 'approved' | 'rejected'

export interface DecisionActor {
  id: string
  role: UserRole
  companyId: string
}

export interface NoteSubmitter {
  id: string
  role: UserRole
  managerId: string | null
  companyId: string
}

// 404 côté route : la note n'existe pas ou n'est pas visible par l'acteur.
export class ExpenseNoteNotVisible extends Error {
  constructor() {
    super('Not found')
    this.name = 'ExpenseNoteNotVisible'
  }
}

// 409 côté route : visible mais déjà tranchée.
export class ExpenseNoteAlreadyDecided extends Error {
  constructor() {
    super('Already decided')
    this.name = 'ExpenseNoteAlreadyDecided'
  }
}

function canDecideOn(actor: DecisionActor, submitter: NoteSubmitter): boolean {
  if (actor.role === 'manager') {
    return submitter.managerId === actor.id
  }
  if (actor.role === 'hr_admin') {
    return submitter.role === 'manager' && submitter.managerId === null && submitter.companyId === actor.companyId
  }
  return false
}

export function decideExpenseNote(
  note: ExpenseNote,
  submitter: NoteSubmitter,
  actor: DecisionActor,
  decision: Decision
): ExpenseNote {
  if (!canDecideOn(actor, submitter)) {
    throw new ExpenseNoteNotVisible()
  }
  if (!note.canBeDecided()) {
    throw new ExpenseNoteAlreadyDecided()
  }
  return decision === 'approved' ? note.approve() : note.reject()
}
