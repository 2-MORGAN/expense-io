import { randomUUID } from 'node:crypto'
import type { ReceiptStoragePort } from '@/ports/ReceiptStoragePort'
import type {
  ExpenseNoteSubmissionRepository,
  SubmittedExpenseNote,
} from '@/ports/ExpenseNoteSubmissionRepository'

export interface SubmissionInput {
  amount: number
  expenseDate: string
  description: string
  receipt: { data: Buffer; mimeType: string; extension: string }
}

// ADR-003 §3 : l'étape non transactionnelle (S3) passe en premier, là où son
// échec ne laisse aucune ligne ; la note est ensuite écrite en une seule
// transaction, avec sa clé de reçu. Jamais de note sans reçu.
export class SubmitExpenseNote {
  constructor(
    private readonly repository: ExpenseNoteSubmissionRepository,
    private readonly storage: ReceiptStoragePort,
    private readonly newId: () => string = randomUUID
  ) {}

  async execute(userId: string, input: SubmissionInput): Promise<SubmittedExpenseNote> {
    const companyId = await this.repository.companyIdOf(userId)
    const noteId = this.newId()
    // Clé opaque, préfixée par l'entreprise (S8, ADR-001 §2 point 5).
    const receiptKey = `receipts/${companyId}/${noteId}${input.receipt.extension}`

    await this.storage.upload(receiptKey, input.receipt.data, input.receipt.mimeType)

    try {
      return await this.repository.create(userId, {
        id: noteId,
        amount: input.amount,
        expenseDate: input.expenseDate,
        description: input.description,
        receiptKey,
      })
    } catch (error) {
      // L'échec peut cacher un COMMIT réussi dont l'accusé s'est perdu : on ne
      // supprime l'objet que si la base confirme l'absence de la note. Sinon il
      // reste, et la réconciliation quotidienne des orphelins le rattrape.
      const committed = await this.repository.find(userId, noteId).catch(() => 'unknown' as const)
      if (committed === null) await this.storage.delete(receiptKey).catch(() => {})
      if (committed && committed !== 'unknown') return committed
      throw error
    }
  }
}
