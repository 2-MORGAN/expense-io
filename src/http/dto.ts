import type { components } from '@/types/api'

export type ExpenseNote = components['schemas']['ExpenseNote']
export type CompanyUser = components['schemas']['CompanyUser']

// Persistence shape stays distinct from the wire DTO; serializer centralisation is 2-487.
export interface ExpenseNoteRow {
  id: string
  user_id: string
  amount: string
  expense_date: string
  description: string
  receipt_key: string
  status: ExpenseNote['status']
  created_at: string | Date
}
