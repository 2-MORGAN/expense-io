import { describe, expect, it } from 'vitest'
import { NonRetryableError, type OutboxEventRecord } from '@/ports/EventOutbox'
import {
  INVITATION_REQUESTED,
  companyNameFromDomain,
  invitationEmail,
  invitationExpiry,
  invitationIdOf,
  invitationUrl,
  normalizeInvitationEmail,
  parseEmail,
  userIdOf,
  verificationEmail,
  verificationUrl,
} from './identity'

const ID = '0b6f1c1e-4a2b-4c3d-8e9f-1a2b3c4d5e6f'

function event(payload: Record<string, unknown>): OutboxEventRecord {
  return { id: 'evt-1', companyId: 'company-1', type: INVITATION_REQUESTED, payload, attempts: 1, createdAt: new Date() }
}

describe('parseEmail', () => {
  it('rend l’adresse telle que saisie et le domaine en minuscules', () => {
    expect(parseEmail('Alice@Acme.Example')).toEqual({ email: 'Alice@Acme.Example', domain: 'acme.example' })
  })
  it('refuse une adresse sans point dans le domaine, ou qui n’est pas une chaîne', () => {
    expect(parseEmail('alice@localhost')).toBeNull()
    expect(parseEmail('pas une adresse')).toBeNull()
    expect(parseEmail(null)).toBeNull()
  })

  // ReDoS (constat SonarJS super-linear-regex) : l'email vient du formulaire
  // public d'inscription, sans borne de longueur. L'ancienne regex mettait
  // 16 s sur 100 000 caractères, en bloquant le serveur.
  it.each([
    ['des points sans fin, puis une espace', `a@${'.'.repeat(100_000)} `],
    ['un domaine sans point, puis une espace', `a@${'b'.repeat(100_000)} `],
    ['des arobases', '@'.repeat(100_000)],
  ])('reste en temps linéaire sur une entrée piégée : %s', (_label, input) => {
    const started = performance.now()
    expect(parseEmail(input)).toBeNull()
    expect(performance.now() - started).toBeLessThan(250)
  })

  it('accepte et refuse exactement ce qu’acceptait l’ancienne expression régulière', () => {
    const oracle = (value: string) => {
      // eslint-disable-next-line sonarjs/super-linear-regex -- l'ancienne règle, gardée comme oracle : appliquée ici à des chaînes de 10 caractères au plus
      const match = /^[^\s@]+@([^\s@]+\.[^\s@]+)$/.exec(value)
      return match ? { email: value, domain: match[1].toLowerCase() } : null
    }
    for (const value of randomStrings(['a', 'B', '.', '@', ' ', '\t', '\n', '\u00a0', '\u2028', 'é', '-'], 20_000, 10)) {
      expect(parseEmail(value), JSON.stringify(value)).toEqual(oracle(value))
    }
  })
})

/** Chaînes pseudo-aléatoires reproductibles (graine fixe) sur un petit alphabet. */
function randomStrings(alphabet: readonly string[], count: number, maxLength: number): string[] {
  let seed = 20261029
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }
  return Array.from({ length: count }, () =>
    Array.from({ length: Math.floor(next() * (maxLength + 1)) }, () => alphabet[Math.floor(next() * alphabet.length)]).join('')
  )
}

describe('normalizeInvitationEmail', () => {
  it('retire les espaces et passe en minuscules', () => {
    expect(normalizeInvitationEmail('  Bob@ACME.example ')).toBe('bob@acme.example')
  })
  it('refuse une adresse invalide', () => {
    expect(normalizeInvitationEmail('bob@')).toBeNull()
    expect(normalizeInvitationEmail(undefined)).toBeNull()
  })
  it('refuse les adresses que le contrat refuserait en réponse (format email)', () => {
    for (const address of [
      'a..b@example.org', '.a@example.org', 'a.@example.org', 'a(b)@example.org', 'a,b@example.org',
      'a"b@example.org', 'a<b>@example.org', 'é@example.org', 'a@-example.org', 'a@example-.org',
      'a@example..org', 'a@.example.org', 'a@exa_mple.org', 'a@exa!mple.org', 'a@exämple.org', 'a@[1.2.3.4]',
    ]) {
      expect(normalizeInvitationEmail(address), address).toBeNull()
    }
  })
  it('accepte les adresses usuelles', () => {
    for (const address of ['bob@acme.example', "o'neil+rh@sub.acme-corp.example", 'inv-01.1a2b3c4d@invite.e2e.test', 'a@b.c']) {
      expect(normalizeInvitationEmail(address), address).toBe(address)
    }
  })
})

describe('règles d’inscription', () => {
  it('une invitation expire 7 jours après sa création ou sa relance', () => {
    expect(invitationExpiry(new Date('2026-10-26T10:00:00Z')).toISOString()).toBe('2026-11-02T10:00:00.000Z')
  })
  it('le nom de l’entreprise vient du domaine, comme avant (sans en déduire l’appartenance)', () => {
    expect(companyNameFromDomain('acme.example')).toBe('acme')
  })
})

describe('payloads de l’outbox', () => {
  it('ne transportent que des ids', () => {
    expect(invitationIdOf(event({ invitationId: ID }))).toBe(ID)
    expect(userIdOf(event({ userId: ID }))).toBe(ID)
  })
  it('un payload invalide n’est pas relancé', () => {
    expect(() => invitationIdOf(event({}))).toThrow(NonRetryableError)
    expect(() => userIdOf(event({ userId: 'pas-un-uuid' }))).toThrow(NonRetryableError)
  })
})

describe('emails', () => {
  it('les liens portent le jeton, encodé, sur l’adresse publique', () => {
    expect(invitationUrl('https://app.example/', 'a+b')).toBe('https://app.example/signup?invitation=a%2Bb')
    expect(verificationUrl('https://app.example', 'tok')).toBe('https://app.example/verify-email?token=tok')
  })
  it('retirent toutes les barres finales de l’adresse, en temps linéaire', () => {
    expect(invitationUrl('https://app.example///', 't')).toBe('https://app.example/signup?invitation=t')
    const started = performance.now()
    verificationUrl(`${'/'.repeat(100_000)}x`, 't')
    expect(performance.now() - started).toBeLessThan(250)
  })
  it('l’invitation nomme l’entreprise, le lien et sa date de fin', () => {
    const message = invitationEmail({
      to: 'bob@acme.example',
      companyName: 'acme',
      url: 'https://app.example/signup?invitation=tok',
      expiresAt: new Date('2026-11-02T10:00:00Z'),
    })
    expect(message.to).toBe('bob@acme.example')
    expect(message.subject).toContain('acme')
    expect(message.text).toContain('https://app.example/signup?invitation=tok')
    expect(message.text).toContain('2026-11-02')
  })
  it('la vérification contient le lien', () => {
    const message = verificationEmail({ to: 'alice@acme.example', name: 'Alice', url: 'https://app.example/verify-email?token=tok' })
    expect(message.to).toBe('alice@acme.example')
    expect(message.text).toContain('https://app.example/verify-email?token=tok')
  })
})
