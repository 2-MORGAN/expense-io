// Mise en forme unique d'une note de frais en DTO JSON (WS2).
// Les montants arrivent en `numeric` (chaîne) et les dates en `YYYY-MM-DD`
// (parser OID 1082 volontairement brut) : la conversion a lieu ici, à la frontière.
export interface ExpenseNoteRow {
  id: unknown
  user_id: unknown
  amount: unknown
  expense_date: unknown
  description: unknown
  receipt_key: unknown
  status: unknown
  created_at: unknown
}

export function toExpenseNoteDto(row: ExpenseNoteRow) {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    amount: Number.parseFloat(row.amount as string),
    expenseDate: row.expense_date as string,
    description: row.description as string,
    receiptKey: row.receipt_key as string,
    status: row.status as 'pending' | 'approved' | 'rejected',
    createdAt: new Date(row.created_at as string | Date).toISOString(),
  }
}
