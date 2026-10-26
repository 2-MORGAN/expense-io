export interface NewExpenseNote {
  id: string
  amount: number
  expenseDate: string
  description: string
  receiptKey: string
}

export interface SubmittedExpenseNote {
  id: string
  user_id: string
  amount: string
  expense_date: string
  description: string
  receipt_key: string
  status: 'pending' | 'approved' | 'rejected'
  created_at: Date
}

export interface ExpenseNoteSubmissionRepository {
  /** Entreprise de l'utilisateur, lue en base : elle préfixe la clé du reçu. */
  companyIdOf(userId: string): Promise<string>
  /** Insère la note, reçu déjà stocké, en une seule transaction. */
  create(userId: string, note: NewExpenseNote): Promise<SubmittedExpenseNote>
  find(userId: string, noteId: string): Promise<SubmittedExpenseNote | null>
}
