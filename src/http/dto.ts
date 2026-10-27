import type { components } from '@/types/api'

export type ExpenseNote = components['schemas']['ExpenseNote']
export type CompanyUser = components['schemas']['CompanyUser']
export type Invitation = components['schemas']['Invitation']

// La ligne PostgreSQL reste distincte du DTO : sa mise en forme unique est
// toExpenseNoteDto (src/http/expenseNote.ts, 2-487).
