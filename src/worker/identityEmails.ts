import type { PoolClient } from 'pg'
import { PgIdentityEmailTokens } from '@/adapters/PgIdentityEmailTokens'
import { SendIdentityEmails, type TokenGenerator } from '@/application/SendIdentityEmails'
import {
  EMAIL_VERIFICATION_REQUESTED,
  INVITATION_REQUESTED,
  invitationIdOf,
  userIdOf,
} from '@/domain/identity/identity'
import type { EmailPort } from '@/ports/EmailPort'
import { BACKOFF_SECONDS } from '@/worker/retry'
import type { OutboxHandlers } from '@/worker/processNextEvent'

/**
 * Emails d'invitation et de vérification (S7, 2-496) : traitements courts,
 * dans la transaction de l'événement. Relances selon l'ADR-003 §5.
 */
export function identityEmailHandlers(
  email: EmailPort,
  appUrl: string,
  generateToken: TokenGenerator
): OutboxHandlers {
  const sender = (client: PoolClient) =>
    new SendIdentityEmails(new PgIdentityEmailTokens(client), email, appUrl, generateToken)
  return {
    [INVITATION_REQUESTED]: {
      maxRetries: BACKOFF_SECONDS.length,
      handle: async (event, client) => {
        await sender(client).sendInvitation(invitationIdOf(event))
      },
    },
    [EMAIL_VERIFICATION_REQUESTED]: {
      maxRetries: BACKOFF_SECONDS.length,
      handle: async (event, client) => {
        await sender(client).sendVerification(userIdOf(event))
      },
    },
  }
}
