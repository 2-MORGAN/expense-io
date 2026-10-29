import { describe, expect, it } from 'vitest'
import {
  approverIds,
  expenseNoteDecided,
  expenseNoteSubmitted,
  isDecidedPayload,
  isSubmittedPayload,
} from '@/modules/expenses/domain/Notification'

describe('approverIds', () => {
  it('employé rattaché → son manager', () => {
    expect(approverIds({ role: 'employee', managerId: 'm1' }, ['hr1'])).toEqual(['m1'])
  })
  it('manager non racine → son propre manager', () => {
    expect(approverIds({ role: 'manager', managerId: 'm0' }, ['hr1'])).toEqual(['m0'])
  })
  it('manager racine → toutes les RH de l’entreprise', () => {
    expect(approverIds({ role: 'manager', managerId: null }, ['hr1', 'hr2'])).toEqual(['hr1', 'hr2'])
  })
  it('employé sans manager ou RH → personne', () => {
    expect(approverIds({ role: 'employee', managerId: null }, ['hr1'])).toEqual([])
    expect(approverIds({ role: 'hr_admin', managerId: null }, ['hr1'])).toEqual([])
  })
  it('manager racine dans une entreprise sans RH → personne', () => {
    expect(approverIds({ role: 'manager', managerId: null }, [])).toEqual([])
  })
  it('RH rattachée par erreur à un manager → personne', () => {
    expect(approverIds({ role: 'hr_admin', managerId: 'm1' }, ['hr1'])).toEqual([])
  })
})

describe('événements', () => {
  it('note soumise → les approbateurs, sans montant ni reçu', () => {
    expect(expenseNoteSubmitted({ id: 'n1', description: 'Taxi' }, 'Emile', ['m1'])).toEqual({
      type: 'expense_note.submitted',
      payload: { noteId: 'n1', description: 'Taxi', submitterName: 'Emile', recipientIds: ['m1'] },
    })
  })
  it('note tranchée → le soumetteur, sans montant ni reçu', () => {
    expect(expenseNoteDecided({ id: 'n1', description: 'Taxi', userId: 'u1' }, 'approved')).toEqual({
      type: 'expense_note.decided',
      payload: { noteId: 'n1', description: 'Taxi', decision: 'approved', recipientIds: ['u1'] },
    })
  })
  it('payload de soumission validé avant envoi', () => {
    expect(isSubmittedPayload({ noteId: 'n1', description: 'Taxi', submitterName: 'Emile', recipientIds: ['m1'] })).toBe(true)
    expect(isSubmittedPayload({ noteId: 'n1', description: 'Taxi', submitterName: 'Emile' })).toBe(false)
    expect(isSubmittedPayload({ noteId: 'n1', description: 'Taxi', submitterName: 'Emile', recipientIds: [42] })).toBe(false)
  })
  it('payload de soumission : non-objet et champs manquants refusés', () => {
    expect(isSubmittedPayload(null)).toBe(false)
    expect(isSubmittedPayload('x')).toBe(false)
    expect(isSubmittedPayload({ noteId: 'n1', description: 'Taxi', recipientIds: ['m1'] })).toBe(false)
  })
  it('payload de décision validé avant envoi', () => {
    expect(isDecidedPayload({ noteId: 'n1', description: 'Taxi', decision: 'rejected', recipientIds: ['u1'] })).toBe(true)
    expect(isDecidedPayload({ noteId: 'n1', description: 'Taxi', decision: 'pending', recipientIds: ['u1'] })).toBe(false)
    expect(isDecidedPayload({ noteId: 'n1', description: 'Taxi', decision: 'approved' })).toBe(false)
    expect(isDecidedPayload({ noteId: 'n1', description: 'Taxi', decision: 'approved', recipientIds: [null] })).toBe(false)
    expect(isDecidedPayload(undefined)).toBe(false)
  })
})
