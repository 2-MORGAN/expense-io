import type { UserRole } from '@/modules/identity/domain/User'

// Règle « qui voit le reçu de quelle note » : pure, sans base ni HTTP. Domaine
// Expense (ADR-002 §3.2 : `ExpenseNote`, `Receipt`, `.../[id]/receipt-url`).
// Figée à l'identique du SQL des 3 routes receipt-url qu'elle remplace
// (ADR-006, Strangler Fig) ; une route = un périmètre :
// - own : sa propre note (route employé, ouverte à tout rôle),
// - team : note d'un subordonné direct de la même entreprise (S2),
// - company : note d'un manager racine de sa propre entreprise (RH).
// Refusé → `ReceiptNotVisible`, traduit en 404 par la couche HTTP.

export type ReceiptScope = 'own' | 'team' | 'company'

/** Qui demande le reçu. */
export interface ReceiptViewer {
  id: string
  role: UserRole
  companyId: string
}

/** L'auteur de la note dont on demande le reçu. */
export interface ReceiptOwner {
  id: string
  role: UserRole
  managerId: string | null
  companyId: string
}

/** Note absente ou hors du périmètre du lecteur : même réponse (404) dans les deux cas. */
export class ReceiptNotVisible extends Error {
  constructor() {
    super('Not found')
    this.name = 'ReceiptNotVisible'
  }
}

export function canViewReceipt(scope: ReceiptScope, viewer: ReceiptViewer, owner: ReceiptOwner): boolean {
  switch (scope) {
    case 'own':
      return owner.id === viewer.id
    case 'team':
      return owner.managerId === viewer.id && owner.companyId === viewer.companyId
    case 'company':
      return owner.role === 'manager' && owner.managerId === null && owner.companyId === viewer.companyId
  }
}
