import { describe, expect, it } from 'vitest'
import { normalizeInvitationEmail } from '@/domain/identity/identity'
import { compileContractSchema } from './validation'

// Point 1 de l'audit API : une adresse acceptée par la règle du domaine doit
// produire un 201 conforme au contrat (`Invitation.email`, format email).
const contractEmail = compileContractSchema({ $ref: '#/components/schemas/Invitation/properties/email' })

const CORPUS = [
  'bob@acme.example', "o'neil+rh@sub.acme-corp.example", 'a@b.c', 'x@x.x',
  'a..b@example.org', '.a@example.org', 'a.@example.org', 'a(b)@example.org', 'a,b@example.org',
  'a"b@example.org', 'a<b>@example.org', 'é@example.org', 'a@-example.org', 'a@example-.org',
  'a@example..org', 'a@.example.org', 'a@exa_mple.org', 'a@exa!mple.org', 'a@exämple.org',
  'a@[1.2.3.4]', `${'a'.repeat(64)}@example.org`, `a@${'b'.repeat(63)}.org`, `a@${'b'.repeat(64)}.org`,
]

describe('adresse d’invitation et contrat', () => {
  it.each(CORPUS)('%s : acceptée par le domaine ⇒ conforme au contrat', (address) => {
    const normalized = normalizeInvitationEmail(address)
    if (normalized !== null) expect(contractEmail(normalized)).toBe(true)
  })
})
