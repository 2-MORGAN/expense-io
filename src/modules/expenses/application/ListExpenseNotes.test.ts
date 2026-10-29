import { describe, expect, it, vi } from 'vitest'
import { ListExpenseNotes } from './ListExpenseNotes'
import type { ExpenseNoteListRepository, ListedExpenseNote } from '@/modules/expenses/ports/ExpenseNoteListRepository'

const note: ListedExpenseNote = {
  id: 'note-1',
  user_id: 'employee-1',
  amount: '42.50',
  expense_date: '2026-10-01',
  description: 'Taxi',
  receipt_key: 'receipts/company-1/note-1.jpg',
  status: 'pending',
  created_at: new Date('2026-10-02T10:00:00.000Z'),
}

function repository(): ExpenseNoteListRepository {
  return {
    listOwn: vi.fn(async () => [note]),
    listPendingForManager: vi.fn(async () => [note]),
    listPendingForHr: vi.fn(async () => [note]),
  }
}

describe('ListExpenseNotes', () => {
  it('liste ses propres notes avec le tri analysé par le domaine', async () => {
    const notes = repository()
    const useCase = new ListExpenseNotes(notes)

    await expect(useCase.own('employee-1', 'Amount desc')).resolves.toEqual([note])
    expect(notes.listOwn).toHaveBeenCalledWith('employee-1', 'amount DESC')

    await useCase.own('employee-1', 'amount; DROP TABLE users')
    expect(notes.listOwn).toHaveBeenLastCalledWith('employee-1', 'created_at DESC')

    await useCase.own('employee-1', null)
    expect(notes.listOwn).toHaveBeenLastCalledWith('employee-1', 'created_at DESC')
  })

  it('délègue les listes manager et RH avec l’id du lecteur', async () => {
    const notes = repository()
    const useCase = new ListExpenseNotes(notes)

    await expect(useCase.pendingForManager('manager-1')).resolves.toEqual([note])
    expect(notes.listPendingForManager).toHaveBeenCalledWith('manager-1')

    await expect(useCase.pendingForHr('hr-1')).resolves.toEqual([note])
    expect(notes.listPendingForHr).toHaveBeenCalledWith('hr-1')
  })
})
