export interface CompanyMember {
  id: string
  name: string
  email: string
  role: 'employee' | 'manager'
  managerId: string | null
}

export type AssignManagerResult =
  | { kind: 'assigned'; user: CompanyMember }
  | { kind: 'not_found' }
  | { kind: 'invalid_manager' }

/**
 * Annuaire de l'entreprise vu par sa RH (`/hr`). Chaque appel s'exécute sous
 * le contexte de la RH `actorId` : la RLS borne la lecture et le rattachement
 * à son entreprise (ADR-001).
 */
export interface CompanyDirectory {
  /** Employés et managers de l'entreprise de la RH, triés par nom. */
  listMembers(actorId: string): Promise<CompanyMember[]>
  /**
   * Rattache `userId` à `managerId` (ou le détache avec `null`). `not_found` :
   * salarié hors de l'entreprise ou inconnu ; `invalid_manager` : lui-même, ou
   * pas un manager de l'entreprise.
   */
  assignManager(actorId: string, userId: string, managerId: string | null): Promise<AssignManagerResult>
}
