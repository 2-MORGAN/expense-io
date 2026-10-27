import type { DecisionActor, NoteSubmitter } from '@/domain/validation/DecideExpenseNote'

// Règle « qui voit le reçu de quelle note » : pure, sans base ni HTTP.
// Figée à l'identique du SQL des 3 routes receipt-url qu'elle remplace
// (ADR-006, Strangler Fig) ; une route = un périmètre :
// - own : sa propre note (route employé, ouverte à tout rôle),
// - team : note d'un subordonné direct de la même entreprise (S2),
// - company : note d'un manager racine de sa propre entreprise (RH).
// Refusé → `ExpenseNoteNotVisible`, traduit en 404 par la couche HTTP.

export type ReceiptScope = 'own' | 'team' | 'company'

export function canViewReceipt(scope: ReceiptScope, viewer: DecisionActor, submitter: NoteSubmitter): boolean {
  switch (scope) {
    case 'own':
      return submitter.id === viewer.id
    case 'team':
      return submitter.managerId === viewer.id && submitter.companyId === viewer.companyId
    case 'company':
      return submitter.role === 'manager' && submitter.managerId === null && submitter.companyId === viewer.companyId
  }
}
