import { describe, expect, it } from 'vitest'
import { canViewReceipt } from './ReceiptAccess'
import type { DecisionActor, NoteSubmitter } from './DecideExpenseNote'

// Règle « qui voit quel reçu » : un périmètre par route receipt-url, à
// l'identique des tests RECU-02, RECU-05, RECU-07 et RECU-08.

const employee: DecisionActor = { id: 'employee-1', role: 'employee', companyId: 'company-1' }
const manager: DecisionActor = { id: 'manager-1', role: 'manager', companyId: 'company-1' }
const hr: DecisionActor = { id: 'hr-1', role: 'hr_admin', companyId: 'company-1' }

const ownNote: NoteSubmitter = { id: 'employee-1', role: 'employee', managerId: 'manager-1', companyId: 'company-1' }
const colleague: NoteSubmitter = { id: 'employee-2', role: 'employee', managerId: 'manager-1', companyId: 'company-1' }
const otherTeam: NoteSubmitter = { id: 'employee-3', role: 'employee', managerId: 'manager-2', companyId: 'company-1' }
const otherCompany: NoteSubmitter = { id: 'employee-4', role: 'employee', managerId: 'manager-1', companyId: 'company-2' }
const rootManager: NoteSubmitter = { id: 'manager-1', role: 'manager', managerId: null, companyId: 'company-1' }
const subManager: NoteSubmitter = { id: 'manager-3', role: 'manager', managerId: 'manager-1', companyId: 'company-1' }
const foreignRootManager: NoteSubmitter = { id: 'manager-9', role: 'manager', managerId: null, companyId: 'company-2' }

describe('canViewReceipt', () => {
  describe('own (route employé)', () => {
    it('autorise sa propre note', () => {
      expect(canViewReceipt('own', employee, ownNote)).toBe(true)
    })

    it('refuse la note d’un collègue ou de son manager', () => {
      expect(canViewReceipt('own', employee, colleague)).toBe(false)
      expect(canViewReceipt('own', employee, rootManager)).toBe(false)
    })
  })

  describe('team (route manager)', () => {
    it('autorise la note d’un subordonné direct de la même entreprise', () => {
      expect(canViewReceipt('team', manager, colleague)).toBe(true)
    })

    it('refuse une note hors de son équipe, d’une autre entreprise ou la sienne (RECU-08)', () => {
      expect(canViewReceipt('team', manager, otherTeam)).toBe(false)
      expect(canViewReceipt('team', manager, otherCompany)).toBe(false)
      expect(canViewReceipt('team', manager, rootManager)).toBe(false)
    })
  })

  describe('company (route RH)', () => {
    it('autorise la note d’un manager racine de son entreprise', () => {
      expect(canViewReceipt('company', hr, rootManager)).toBe(true)
    })

    it('refuse un employé, un manager non racine ou un manager racine d’une autre entreprise', () => {
      expect(canViewReceipt('company', hr, colleague)).toBe(false)
      expect(canViewReceipt('company', hr, subManager)).toBe(false)
      expect(canViewReceipt('company', hr, foreignRootManager)).toBe(false)
    })
  })
})
