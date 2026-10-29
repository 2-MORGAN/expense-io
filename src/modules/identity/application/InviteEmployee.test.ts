import { describe, expect, it, vi } from 'vitest'
import { InvalidEmail } from '@/modules/identity/domain/identity'
import type { InvitationRepository } from '@/modules/identity/ports/InvitationRepository'
import { InviteEmployee } from './InviteEmployee'

const now = () => new Date('2026-10-26T10:00:00Z')

describe('InviteEmployee', () => {
  it('invite l’adresse normalisée, pour 7 jours, dans l’entreprise de la RH', async () => {
    const invitation = { id: 'inv-1', email: 'bob@acme.example', expiresAt: '2026-11-02T10:00:00.000Z' }
    const repository: InvitationRepository = { invite: vi.fn(async () => invitation) }

    await expect(new InviteEmployee(repository, now).execute('hr-1', ' Bob@Acme.example ')).resolves.toEqual(invitation)
    expect(repository.invite).toHaveBeenCalledWith('hr-1', 'bob@acme.example', new Date('2026-11-02T10:00:00Z'))
  })

  it('refuse une adresse invalide sans rien écrire', async () => {
    const repository: InvitationRepository = { invite: vi.fn() }
    expect(() => new InviteEmployee(repository, now).execute('hr-1', 'bob@')).toThrow(InvalidEmail)
    expect(() => new InviteEmployee(repository, now).execute('hr-1', 42)).toThrow(InvalidEmail)
    expect(repository.invite).not.toHaveBeenCalled()
  })
})
