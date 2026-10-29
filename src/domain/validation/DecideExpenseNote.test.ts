import { describe, expect, it } from 'vitest'
import { ExpenseNote } from '@/domain/ExpenseNote'
import {
  ExpenseNoteAlreadyDecided,
  ExpenseNoteNotVisible,
  decideExpenseNote,
  type DecisionActor,
  type NoteSubmitter,
} from './DecideExpenseNote'

// Règle « valider ou rejeter une note » : qui peut trancher quelle note,
// seulement si elle est en attente. Miroir du workflow AGENTS.md :
// employé → manager direct, manager racine → RH de l'entreprise.

const pendingNote = () =>
  new ExpenseNote({
    id: 'note-1',
    userId: 'submitter-1',
    amount: 42.5,
    expenseDate: '2026-10-01',
    description: 'Taxi',
    receiptKey: 'company-1/receipt-1.jpg',
    status: 'pending',
  })

const decidedNote = () =>
  new ExpenseNote({
    id: 'note-2',
    userId: 'submitter-1',
    amount: 10,
    expenseDate: '2026-10-01',
    description: 'Déjà tranchée',
    receiptKey: 'company-1/receipt-2.jpg',
    status: 'approved',
  })

const manager: DecisionActor = { id: 'manager-1', role: 'manager', companyId: 'company-1' }
const directReport: NoteSubmitter = { id: 'employee-1', role: 'employee', managerId: 'manager-1', companyId: 'company-1' }
const otherTeam: NoteSubmitter = { id: 'employee-2', role: 'employee', managerId: 'manager-2', companyId: 'company-1' }
const rootManager: NoteSubmitter = { id: 'manager-1', role: 'manager', managerId: null, companyId: 'company-1' }
const subManager: NoteSubmitter = { id: 'manager-2', role: 'manager', managerId: 'manager-1', companyId: 'company-1' }
const hr: DecisionActor = { id: 'hr-1', role: 'hr_admin', companyId: 'company-1' }
const otherCompanyRoot: NoteSubmitter = { id: 'manager-9', role: 'manager', managerId: null, companyId: 'company-9' }
const employeeActor: DecisionActor = { id: 'employee-1', role: 'employee', companyId: 'company-1' }

describe('decideExpenseNote', () => {
  describe('manager', () => {
    it.each(['approved', 'rejected'] as const)('tranche la note en attente de son subordonné direct (%s)', (decision) => {
      expect(decideExpenseNote(pendingNote(), directReport, manager, decision).status).toBe(decision)
    })

    it('tranche la note en attente de son manager rattaché (N+1)', () => {
      expect(decideExpenseNote(pendingNote(), subManager, manager, 'approved').status).toBe('approved')
    })

    it('refuse une note hors de son équipe (404)', () => {
      expect(() => decideExpenseNote(pendingNote(), otherTeam, manager, 'approved')).toThrow(ExpenseNoteNotVisible)
    })

    it('refuse la note déjà tranchée de son équipe (409)', () => {
      expect(() => decideExpenseNote(decidedNote(), directReport, manager, 'approved')).toThrow(
        ExpenseNoteAlreadyDecided
      )
    })
  })

  describe('RH', () => {
    it.each(['approved', 'rejected'] as const)('tranche la note en attente d’un manager racine de son entreprise (%s)', (decision) => {
      expect(decideExpenseNote(pendingNote(), rootManager, hr, decision).status).toBe(decision)
    })

    it('refuse la note déjà tranchée d’un manager racine (409)', () => {
      expect(() => decideExpenseNote(decidedNote(), rootManager, hr, 'approved')).toThrow(
        ExpenseNoteAlreadyDecided
      )
    })

    it('refuse la note déjà tranchée (409) sur reject', () => {
      expect(() => decideExpenseNote(decidedNote(), rootManager, hr, 'rejected')).toThrow(ExpenseNoteAlreadyDecided)
    })

    it('refuse la note d’un employé (404)', () => {
      expect(() => decideExpenseNote(pendingNote(), directReport, hr, 'approved')).toThrow(ExpenseNoteNotVisible)
    })

    it('refuse la note d’un manager non racine (404)', () => {
      expect(() => decideExpenseNote(pendingNote(), subManager, hr, 'approved')).toThrow(ExpenseNoteNotVisible)
    })

    it('refuse la note d’un manager racine d’une autre entreprise (404)', () => {
      expect(() => decideExpenseNote(pendingNote(), otherCompanyRoot, hr, 'approved')).toThrow(
        ExpenseNoteNotVisible
      )
    })
  })

  describe('acteurs non autorisés', () => {
    it('un employé ne tranche rien (404)', () => {
      expect(() => decideExpenseNote(pendingNote(), directReport, employeeActor, 'approved')).toThrow(
        ExpenseNoteNotVisible
      )
    })
  })

  describe('erreurs', () => {
    it('NotVisible porte le message « Not found » (contrat 404)', () => {
      try {
        decideExpenseNote(pendingNote(), otherTeam, manager, 'approved')
        expect.unreachable()
      } catch (error) {
        expect(error).toBeInstanceOf(ExpenseNoteNotVisible)
        expect((error as Error).message).toBe('Not found')
      }
    })

    it('AlreadyDecided porte le message « Already decided » (contrat 409)', () => {
      try {
        decideExpenseNote(decidedNote(), directReport, manager, 'rejected')
        expect.unreachable()
      } catch (error) {
        expect(error).toBeInstanceOf(ExpenseNoteAlreadyDecided)
        expect((error as Error).message).toBe('Already decided')
      }
    })

    it('renvoie une nouvelle note sans modifier l’originale', () => {
      const original = pendingNote()
      decideExpenseNote(original, directReport, manager, 'approved')
      expect(original.status).toBe('pending')
    })
  })
})
