import { describe, expect, it, vi } from 'vitest'
import { DecideExpenseNote } from './DecideExpenseNote'
import type { ExpenseNoteDecisionRepository } from '@/modules/expenses/ports/ExpenseNoteDecisionRepository'

const decided = {
  id: 'note-1',
  user_id: 'employee-1',
  amount: '42.50',
  expense_date: '2026-10-01',
  description: 'Taxi',
  receipt_key: 'company-1/receipt-1.jpg',
  status: 'approved' as const,
  created_at: new Date('2026-10-02T10:00:00.000Z'),
}

describe('DecideExpenseNote', () => {
  it('délègue au repository avec les mêmes paramètres (une seule logique pour les 4 routes)', async () => {
    const repository: ExpenseNoteDecisionRepository = { decide: vi.fn(async () => decided) }
    const useCase = new DecideExpenseNote(repository)

    await expect(useCase.execute('note-1', 'manager-1', 'approved')).resolves.toEqual(decided)
    expect(repository.decide).toHaveBeenCalledWith('note-1', 'manager-1', 'approved')

    await expect(useCase.execute('note-1', 'hr-1', 'rejected')).resolves.toEqual(decided)
    expect(repository.decide).toHaveBeenCalledWith('note-1', 'hr-1', 'rejected')
  })

  it('propage les erreurs du repository (404/409 traduits par les routes)', async () => {
    const failure = new Error('Already decided')
    const repository: ExpenseNoteDecisionRepository = { decide: vi.fn(async () => Promise.reject(failure)) }
    await expect(new DecideExpenseNote(repository).execute('note-1', 'manager-1', 'approved')).rejects.toBe(
      failure
    )
  })
})
