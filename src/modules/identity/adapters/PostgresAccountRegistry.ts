import { withSystemTransaction } from '@/lib/db'
import type { AcceptInvitationResult, AccountRegistry, NewAccount } from '@/modules/identity/ports/AccountRegistry'

const UNIQUE_VIOLATION = '23505'

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === UNIQUE_VIOLATION
}

/**
 * Inscription, avant toute session : pas de contexte utilisateur à poser.
 * Chaque appel passe uniquement par une fonction `SECURITY DEFINER` de la
 * base (migrations 1793028373424 et 1793100000000), qui reste valable sous
 * le rôle restreint `expense_app` (2-481).
 */
export class PostgresAccountRegistry implements AccountRegistry {
  async verifiedAccountExists(email: string): Promise<boolean> {
    return withSystemTransaction(async (client) => {
      const result = await client.query<{ exists: boolean }>(
        'SELECT EXISTS (SELECT 1 FROM auth_find_user($1) WHERE email_verified_at IS NOT NULL) AS exists',
        [email]
      )
      return result.rows[0].exists
    })
  }

  async registerCompanyAdmin(
    account: NewAccount & { companyName: string; domain: string }
  ): Promise<string | null> {
    try {
      return await withSystemTransaction(async (client) => {
        const result = await client.query<{ user_id: string }>(
          'SELECT register_user($1, $2, $3, $4, $5) AS user_id',
          [account.name, account.email, account.passwordHash, account.companyName, account.domain]
        )
        return result.rows[0].user_id
      })
    } catch (error) {
      if (isUniqueViolation(error)) return null
      throw error
    }
  }

  async acceptInvitation(account: NewAccount & { tokenHash: string }): Promise<AcceptInvitationResult> {
    try {
      return await withSystemTransaction(async (client) => {
        const result = await client.query<{ user_id: string | null; failure: 'invalid' | 'email_taken' | null }>(
          'SELECT user_id, failure FROM accept_invitation($1, $2, $3, $4)',
          [account.name, account.email, account.passwordHash, account.tokenHash]
        )
        const row = result.rows[0]
        return row.user_id ? { userId: row.user_id } : { failure: row.failure ?? 'invalid' }
      })
    } catch (error) {
      if (isUniqueViolation(error)) return { failure: 'email_taken' }
      throw error
    }
  }

  async previewInvitation(tokenHash: string): Promise<{ email: string; companyName: string } | null> {
    return withSystemTransaction(async (client) => {
      const result = await client.query<{ email: string; company_name: string }>(
        'SELECT email, company_name FROM invitation_preview($1)',
        [tokenHash]
      )
      const row = result.rows[0]
      return row ? { email: row.email, companyName: row.company_name } : null
    })
  }

  async verifyEmail(tokenHash: string): Promise<boolean> {
    return withSystemTransaction(async (client) => {
      const result = await client.query<{ verified: boolean }>('SELECT verify_email($1) AS verified', [
        tokenHash,
      ])
      return result.rows[0].verified
    })
  }

  async requestVerification(email: string): Promise<void> {
    await withSystemTransaction(async (client) => {
      await client.query('SELECT request_email_verification($1)', [email])
    })
  }
}
