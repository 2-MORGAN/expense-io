import { describe, expect, it } from 'vitest'
import { PostgresInvitationRepository } from './PostgresInvitationRepository'
import { INVITATION_REQUESTED } from '@/domain/identity/identity'
import { eventsOfCompany } from '../../integration/support/outbox'
import { createTenant, owner } from '../../integration/support/tenant'

// Invitation par la RH, sous son contexte : la policy `invitations_company_hr`
// la borne à son entreprise et à son rôle ; l'événement qui fera partir
// l'email est écrit dans la même transaction (le worker crée le jeton).

const repository = new PostgresInvitationRepository()
const inSevenDays = () => new Date(Date.now() + 7 * 24 * 3600 * 1000)

async function invitation(id: string) {
  const result = await owner().query<{ company_id: string; email: string; invited_by: string; token_hash: string | null; expires_at: Date }>(
    'SELECT company_id, email, invited_by, token_hash, expires_at FROM invitations WHERE id = $1',
    [id]
  )
  return result.rows[0]
}

describe('invite', () => {
  it('crée l’invitation dans l’entreprise de la RH et publie sa demande d’envoi', async () => {
    const { hr, company } = await createTenant('invitation')
    const email = `nouveau@${company.domain}`
    const created = await repository.invite(hr.id, email, inSevenDays())
    expect(created).toMatchObject({ email })
    expect(new Date(created.expiresAt).getTime()).toBeGreaterThan(Date.now())
    // Ni jeton ni statut de l'événement vérifiés : un worker lancé sur la même
    // base (`make dev`) peut déjà avoir envoyé l'email (ADR-003 §5).
    expect(await invitation(created.id)).toMatchObject({ company_id: company.id, invited_by: hr.id })
    expect((await eventsOfCompany(company.id)).filter((event) => event.type === INVITATION_REQUESTED)).toEqual([
      expect.objectContaining({ payload: { invitationId: created.id } }),
    ])
  })

  it('relancer la même adresse (casse ignorée) garde l’invitation, repousse l’échéance et efface l’ancien jeton', async () => {
    const { hr, company } = await createTenant('invitation-relance')
    const first = await repository.invite(hr.id, `relance@${company.domain}`, new Date(Date.now() + 3600 * 1000))
    await owner().query("UPDATE invitations SET token_hash = 'ancien-jeton' WHERE id = $1", [first.id])
    const again = await repository.invite(hr.id, `RELANCE@${company.domain}`, inSevenDays())
    expect(again.id).toBe(first.id)
    const stored = await invitation(first.id)
    // Effacé par la relance ; un worker a pu en poser un nouveau depuis, jamais l'ancien.
    expect(stored.token_hash).not.toBe('ancien-jeton')
    expect(stored.expires_at.getTime()).toBe(new Date(again.expiresAt).getTime())
    expect((await eventsOfCompany(company.id)).filter((event) => event.type === INVITATION_REQUESTED)).toHaveLength(2)
  })

  it.each(['employee', 'manager'] as const)('un %s ne peut pas inviter : refus de la policy (42501), rien d’écrit', async (role) => {
    const tenant = await createTenant(`invitation-${role}`)
    await expect(repository.invite(tenant[role].id, `x@${tenant.company.domain}`, inSevenDays())).rejects.toMatchObject({
      code: '42501',
    })
    expect(await eventsOfCompany(tenant.company.id)).toEqual([])
  })
})
