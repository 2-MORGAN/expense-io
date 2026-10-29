import { InvalidEmail, invitationExpiry, normalizeInvitationEmail } from '@/modules/identity/domain/identity'
import type { InvitationDto, InvitationRepository } from '@/modules/identity/ports/InvitationRepository'

// Invitation d'un salarié par la RH (S7). La route garde l'authentification
// et le rôle (401/403) ; l'entreprise est celle de la RH, lue en base.
export class InviteEmployee {
  constructor(
    private readonly repository: InvitationRepository,
    private readonly now: () => Date = () => new Date()
  ) {}

  execute(actorId: string, email: unknown): Promise<InvitationDto> {
    const normalized = normalizeInvitationEmail(email)
    if (!normalized) throw new InvalidEmail()
    return this.repository.invite(actorId, normalized, invitationExpiry(this.now()))
  }
}
