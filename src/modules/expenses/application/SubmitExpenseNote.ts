import { createHash, randomUUID } from 'node:crypto'
import type { ReceiptStoragePort } from '@/ports/ReceiptStoragePort'
import {
  DuplicateIdempotencyKey,
  type ExpenseNoteSubmissionRepository,
  type SubmittedExpenseNote,
} from '@/ports/ExpenseNoteSubmissionRepository'

export interface SubmissionInput {
  amount: number
  expenseDate: string
  description: string
  receipt: { data: Buffer; mimeType: string; extension: string }
  /** En-tête `Idempotency-Key` ; absent : pas de déduplication. */
  idempotencyKey?: string | null
}

export interface SubmissionResult {
  note: SubmittedExpenseNote
  /** Vrai quand la note existait déjà pour cette clé : rien n'a été créé. */
  replayed: boolean
}

export class InvalidIdempotencyKey extends Error {
  constructor() {
    super('Idempotency-Key must be a UUID')
    this.name = 'InvalidIdempotencyKey'
  }
}

export class IdempotencyKeyReused extends Error {
  constructor() {
    super('Idempotency-Key was already used with another request')
    this.name = 'IdempotencyKeyReused'
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// sha256(montant | date | description | sha256(reçu)) : deux requêtes qui
// portent la même clé doivent avoir exactement le même contenu (ADR-003 §4).
function fingerprintOf(input: SubmissionInput): string {
  const receiptHash = createHash('sha256').update(input.receipt.data).digest('hex')
  return createHash('sha256')
    .update([input.amount, input.expenseDate, input.description, receiptHash].join('|'))
    .digest('hex')
}

type Idempotency = { key: string; fingerprint: string }

// Clé absente : pas de déduplication. Clé présente : un UUID, et l'empreinte
// du contenu pour reconnaître un renvoi identique.
function idempotencyOf(input: SubmissionInput): Idempotency | undefined {
  if (input.idempotencyKey == null) return undefined
  if (!UUID_PATTERN.test(input.idempotencyKey)) throw new InvalidIdempotencyKey()
  return { key: input.idempotencyKey.toLowerCase(), fingerprint: fingerprintOf(input) }
}

// ADR-003 §3 : l'étape non transactionnelle (S3) passe en premier, là où son
// échec ne laisse aucune ligne ; la note est ensuite écrite en une seule
// transaction, avec sa clé de reçu. Jamais de note sans reçu.
// ADR-003 §4 : avec une `Idempotency-Key`, un renvoi rend la note existante.
export class SubmitExpenseNote {
  constructor(
    private readonly repository: ExpenseNoteSubmissionRepository,
    private readonly storage: ReceiptStoragePort,
    private readonly newId: () => string = randomUUID
  ) {}

  async execute(userId: string, input: SubmissionInput): Promise<SubmissionResult> {
    const idempotency = idempotencyOf(input)
    if (idempotency) {
      const known = await this.repository.findByIdempotencyKey(userId, idempotency.key)
      if (known) return this.replay(known, idempotency.fingerprint)
    }

    const companyId = await this.repository.companyIdOf(userId)
    const noteId = this.newId()
    // Clé opaque, préfixée par l'entreprise (S8, ADR-001 §2 point 5).
    const receiptKey = `receipts/${companyId}/${noteId}${input.receipt.extension}`

    await this.storage.upload(receiptKey, input.receipt.data, input.receipt.mimeType)

    try {
      const note = await this.repository.create(userId, {
        id: noteId,
        amount: input.amount,
        expenseDate: input.expenseDate,
        description: input.description,
        receiptKey,
        idempotency,
      })
      return { note, replayed: false }
    } catch (error) {
      return this.recover(error, userId, noteId, receiptKey, idempotency)
    }
  }

  // Échec de l'insertion, reçu déjà stocké : rejeu de la requête concurrente
  // gagnante, COMMIT dont l'accusé s'est perdu, ou échec réel.
  private async recover(
    error: unknown,
    userId: string,
    noteId: string,
    receiptKey: string,
    idempotency: Idempotency | undefined
  ): Promise<SubmissionResult> {
    if (error instanceof DuplicateIdempotencyKey && idempotency) {
      // Requête concurrente de même clé : l'index unique a désigné la
      // gagnante. Son objet est le seul référencé, le nôtre est en trop.
      await this.storage.delete(receiptKey).catch(() => {})
      const winner = await this.repository.findByIdempotencyKey(userId, idempotency.key)
      if (!winner) throw error
      return this.replay(winner, idempotency.fingerprint)
    }
    // L'échec peut cacher un COMMIT réussi dont l'accusé s'est perdu : on ne
    // supprime l'objet que si la base confirme l'absence de la note. Sinon il
    // reste, et la réconciliation quotidienne des orphelins le rattrape.
    const committed = await this.repository.find(userId, noteId).catch(() => 'unknown' as const)
    if (committed === null) await this.storage.delete(receiptKey).catch(() => {})
    if (committed && committed !== 'unknown') return { note: committed, replayed: false }
    throw error
  }

  private replay(note: SubmittedExpenseNote, fingerprint: string): SubmissionResult {
    if (note.request_fingerprint !== fingerprint) throw new IdempotencyKeyReused()
    return { note, replayed: true }
  }
}
