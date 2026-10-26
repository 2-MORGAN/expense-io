import type { PoolClient } from 'pg'
import type { IdentityEmailTokens } from '@/ports/IdentityEmailTokens'

/**
 * Dans la transaction de l'événement du worker : si l'envoi de l'email
 * échoue, le point de sauvegarde annule aussi l'empreinte du jeton. Passe par
 * les fonctions `issue_*_token` de la base (migration 1793100000000).
 */
export class PgIdentityEmailTokens implements IdentityEmailTokens {
  constructor(private readonly client: PoolClient) {}

  async issueInvitationToken(invitationId: string, tokenHash: string) {
    const result = await this.client.query<{ email: string; company_name: string; expires_at: Date }>(
      'SELECT email, company_name, expires_at FROM issue_invitation_token($1, $2)',
      [invitationId, tokenHash]
    )
    const row = result.rows[0]
    return row ? { email: row.email, companyName: row.company_name, expiresAt: row.expires_at } : null
  }

  async issueVerificationToken(userId: string, tokenHash: string, ttlHours: number) {
    const result = await this.client.query<{ email: string; name: string }>(
      "SELECT email, name FROM issue_verification_token($1, $2, make_interval(hours => $3))",
      [userId, tokenHash, ttlHours]
    )
    return result.rows[0] ?? null
  }
}
