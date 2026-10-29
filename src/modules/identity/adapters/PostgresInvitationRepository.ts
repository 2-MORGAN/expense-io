import { PgEventOutbox } from '@/adapters/PgEventOutbox'
import { INVITATION_REQUESTED } from '@/modules/identity/domain/identity'
import { withUserScope } from '@/lib/db'
import type { InvitationDto, InvitationRepository } from '@/modules/identity/ports/InvitationRepository'

export class PostgresInvitationRepository implements InvitationRepository {
  /**
   * Sous le contexte de la RH : la policy `invitations_company_hr` borne
   * l'invitation à son entreprise et à son rôle. Relancer une adresse encore
   * en attente efface l'ancien jeton (lien précédent invalidé) ; le worker en
   * crée un nouveau à l'envoi.
   */
  async invite(actorId: string, email: string, expiresAt: Date): Promise<InvitationDto> {
    return withUserScope(actorId, async (client) => {
      const result = await client.query<{ id: string; email: string; expires_at: Date }>(
        `INSERT INTO invitations (company_id, email, invited_by, expires_at)
         VALUES (nullif(current_setting('app.current_company_id', true), '')::uuid, $1, $2, $3)
         ON CONFLICT (company_id, lower(email)) WHERE accepted_at IS NULL
         DO UPDATE SET expires_at = EXCLUDED.expires_at, token_hash = NULL
         RETURNING id, email, expires_at`,
        [email, actorId, expiresAt]
      )
      const row = result.rows[0]
      await new PgEventOutbox(client).enqueue({
        type: INVITATION_REQUESTED,
        payload: { invitationId: row.id },
      })
      return { id: row.id, email: row.email, expiresAt: row.expires_at.toISOString() }
    })
  }
}
