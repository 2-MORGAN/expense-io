import { describe, expect, it } from 'vitest'
import { ExpenseNote, type ExpenseNoteProps, type ExpenseNoteStatus } from '@/modules/expenses/domain/ExpenseNote'

// Règles du workflow de validation d'une note de frais (CLAUDE.md, « Contexte ») :
// seule une note en attente peut être approuvée ou rejetée, une fois.

const noteWith = (status: ExpenseNoteStatus): ExpenseNote =>
  new ExpenseNote({
    id: 'note-1',
    userId: 'user-1',
    amount: 42.5,
    expenseDate: '2026-10-01',
    description: 'Taxi',
    receiptKey: 'company-1/receipt-1.jpg',
    status,
  })

describe('ExpenseNote', () => {
  describe('canBeDecided', () => {
    it('est vrai pour une note en attente', () => {
      expect(noteWith('pending').canBeDecided()).toBe(true)
    })

    it.each<ExpenseNoteStatus>(['approved', 'rejected'])('est faux pour une note %s', (status) => {
      expect(noteWith(status).canBeDecided()).toBe(false)
    })
  })

  describe('approve', () => {
    it('passe une note en attente à approved', () => {
      expect(noteWith('pending').approve().status).toBe('approved')
    })

    it.each<ExpenseNoteStatus>(['approved', 'rejected'])('refuse une note déjà %s', (status) => {
      expect(() => noteWith(status).approve()).toThrow('déjà été tranchée')
    })
  })

  describe('reject', () => {
    it('passe une note en attente à rejected', () => {
      expect(noteWith('pending').reject().status).toBe('rejected')
    })

    it.each<ExpenseNoteStatus>(['approved', 'rejected'])('refuse une note déjà %s', (status) => {
      expect(() => noteWith(status).reject()).toThrow('déjà été tranchée')
    })
  })

  describe('immutabilité', () => {
    it('approve() renvoie une nouvelle note sans modifier l’originale', () => {
      const original = noteWith('pending')
      const approved = original.approve()
      expect(approved).not.toBe(original)
      expect(original.status).toBe('pending')
    })

    it('conserve les autres champs lors d’une décision', () => {
      const original = noteWith('pending')
      expect(original.reject().toJSON()).toEqual({ ...original.toJSON(), status: 'rejected' })
    })

    it('toJSON() renvoie une copie : la modifier ne change pas la note', () => {
      const note = noteWith('pending')
      const json: ExpenseNoteProps = note.toJSON()
      json.status = 'approved'
      expect(note.status).toBe('pending')
    })
  })
})
