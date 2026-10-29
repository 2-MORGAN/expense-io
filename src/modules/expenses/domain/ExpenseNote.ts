export type ExpenseNoteStatus = 'pending' | 'approved' | 'rejected'

export interface ExpenseNoteProps {
  id: string
  userId: string
  amount: number
  expenseDate: string
  description: string
  receiptKey: string
  status: ExpenseNoteStatus
}

export class ExpenseNote {
  constructor(private readonly props: ExpenseNoteProps) {}

  get id(): string {
    return this.props.id
  }

  get status(): ExpenseNoteStatus {
    return this.props.status
  }

  canBeDecided(): boolean {
    return this.props.status === 'pending'
  }

  approve(): ExpenseNote {
    if (!this.canBeDecided()) {
      throw new Error('Cette note a déjà été tranchée.')
    }
    return new ExpenseNote({ ...this.props, status: 'approved' })
  }

  reject(): ExpenseNote {
    if (!this.canBeDecided()) {
      throw new Error('Cette note a déjà été tranchée.')
    }
    return new ExpenseNote({ ...this.props, status: 'rejected' })
  }

  toJSON(): ExpenseNoteProps {
    return { ...this.props }
  }
}
