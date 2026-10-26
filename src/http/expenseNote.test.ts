import { describe, expect, it } from 'vitest'
import { toExpenseNoteDto } from './expenseNote'

describe('toExpenseNoteDto', () => {
  it('met en forme une ligne SQL (numeric en chaîne, date brute)', () => {
    expect(
      toExpenseNoteDto({
        id: 'note-1',
        user_id: 'user-1',
        amount: '42.50',
        expense_date: '2026-10-01',
        description: 'Taxi',
        receipt_key: 'company-1/receipt-1.jpg',
        status: 'pending',
        created_at: '2026-10-02T10:00:00.000Z',
      })
    ).toEqual({
      id: 'note-1',
      userId: 'user-1',
      amount: 42.5,
      expenseDate: '2026-10-01',
      description: 'Taxi',
      receiptKey: 'company-1/receipt-1.jpg',
      status: 'pending',
      createdAt: '2026-10-02T10:00:00.000Z',
    })
  })

  it('accepte un created_at en Date (retour PG timestamptz)', () => {
    const dto = toExpenseNoteDto({
      id: 'note-2',
      user_id: 'user-2',
      amount: '5.90',
      expense_date: '2026-10-02',
      description: 'Café',
      receipt_key: 'company-1/receipt-2.jpg',
      status: 'approved',
      created_at: new Date('2026-10-03T10:00:00.000Z'),
    })
    expect(dto.createdAt).toBe('2026-10-03T10:00:00.000Z')
    expect(dto.amount).toBe(5.9)
  })
})
