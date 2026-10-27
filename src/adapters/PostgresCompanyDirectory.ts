import { withUserScope } from '@/lib/db'
import type { AssignManagerResult, CompanyDirectory, CompanyMember } from '@/ports/CompanyDirectory'

type MemberRow = {
  id: string
  name: string
  email: string
  role: 'employee' | 'manager'
  manager_id: string | null
}

function toMember(row: MemberRow): CompanyMember {
  return { id: row.id, name: row.name, email: row.email, role: row.role, managerId: row.manager_id }
}

/**
 * Sous le contexte de la RH (2-481) : les policies de `users` bornent lecture
 * et rattachement à son entreprise. Les conditions sur l'entreprise posée par
 * `withUserScope` (lue en base depuis la ligne de la RH) restent, en défense
 * en profondeur (ADR-001 §3).
 */
export class PostgresCompanyDirectory implements CompanyDirectory {
  async listMembers(actorId: string): Promise<CompanyMember[]> {
    return withUserScope(actorId, async (client) => {
      const result = await client.query<MemberRow>(
        `SELECT id, name, email, role, manager_id FROM users
         WHERE role IN ('employee', 'manager')
           AND company_id = nullif(current_setting('app.current_company_id', true), '')::uuid
         ORDER BY name`
      )
      return result.rows.map(toMember)
    })
  }

  async assignManager(actorId: string, userId: string, managerId: string | null): Promise<AssignManagerResult> {
    return withUserScope(actorId, async (client) => {
      const target = await client.query(
        `SELECT id FROM users WHERE id = $1 AND company_id = nullif(current_setting('app.current_company_id', true), '')::uuid AND role IN ('employee', 'manager')`,
        [userId]
      )
      if (!target.rows[0]) return { kind: 'not_found' }

      if (managerId !== null) {
        if (managerId === userId) return { kind: 'invalid_manager' }
        // Le manager choisi doit avoir le rôle manager et appartenir à
        // l'entreprise de la RH (donc de la cible) : un manager d'une autre
        // entreprise est refusé comme un id inconnu. FOR SHARE garde la ligne
        // du manager jusqu'à l'écriture : une rétrogradation concurrente
        // attend la fin du rattachement, ou le rattachement attend la sienne
        // et relit alors le rôle à jour (l'entreprise est déjà garantie par la
        // clé étrangère composite (manager_id, company_id)).
        const manager = await client.query(
          `SELECT id FROM users WHERE id = $1 AND role = 'manager' AND company_id = nullif(current_setting('app.current_company_id', true), '')::uuid FOR SHARE`,
          [managerId]
        )
        if (!manager.rows[0]) return { kind: 'invalid_manager' }
      }

      const updated = await client.query<MemberRow>(
        `UPDATE users SET manager_id = $1 WHERE id = $2
         RETURNING id, name, email, role, manager_id`,
        [managerId, userId]
      )
      return { kind: 'assigned', user: toMember(updated.rows[0]) }
    })
  }
}
