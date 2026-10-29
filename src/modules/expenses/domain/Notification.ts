import type { UserRole } from '@/modules/identity/domain/User'

export const EXPENSE_NOTE_SUBMITTED = 'expense_note.submitted'
export const EXPENSE_NOTE_DECIDED = 'expense_note.decided'

export type NoteDecision = 'approved' | 'rejected'

// Payloads en `type` (pas `interface`) pour rester assignables à Record<string, unknown>.
// Ni montant ni reçu : seuls la description et le statut partent par email.
export type ExpenseNoteSubmittedPayload = {
  noteId: string
  description: string
  submitterName: string
  recipientIds: string[]
}

export type ExpenseNoteDecidedPayload = {
  noteId: string
  description: string
  decision: NoteDecision
  recipientIds: string[]
}

// Qui valide la note d'un soumetteur : son manager direct ; à défaut (manager
// racine), toutes les RH de l'entreprise. Un employé sans manager ou une RH
// n'a personne : la note est créée sans notification.
export function approverIds(
  submitter: { role: UserRole; managerId: string | null },
  hrAdminIds: string[]
): string[] {
  if (submitter.role === 'hr_admin') return []
  if (submitter.managerId !== null) return [submitter.managerId]
  return submitter.role === 'manager' ? [...hrAdminIds] : []
}

export function expenseNoteSubmitted(
  note: { id: string; description: string },
  submitterName: string,
  recipientIds: string[]
): { type: typeof EXPENSE_NOTE_SUBMITTED; payload: ExpenseNoteSubmittedPayload } {
  return {
    type: EXPENSE_NOTE_SUBMITTED,
    payload: {
      noteId: note.id,
      description: note.description,
      submitterName,
      recipientIds: [...recipientIds],
    },
  }
}

export function expenseNoteDecided(
  note: { id: string; description: string; userId: string },
  decision: NoteDecision
): { type: typeof EXPENSE_NOTE_DECIDED; payload: ExpenseNoteDecidedPayload } {
  return {
    type: EXPENSE_NOTE_DECIDED,
    payload: {
      noteId: note.id,
      description: note.description,
      decision,
      recipientIds: [note.userId],
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

export function isSubmittedPayload(value: unknown): value is ExpenseNoteSubmittedPayload {
  return (
    isRecord(value) &&
    typeof value.noteId === 'string' &&
    typeof value.description === 'string' &&
    typeof value.submitterName === 'string' &&
    isStringArray(value.recipientIds)
  )
}

export function isDecidedPayload(value: unknown): value is ExpenseNoteDecidedPayload {
  return (
    isRecord(value) &&
    typeof value.noteId === 'string' &&
    typeof value.description === 'string' &&
    (value.decision === 'approved' || value.decision === 'rejected') &&
    isStringArray(value.recipientIds)
  )
}
