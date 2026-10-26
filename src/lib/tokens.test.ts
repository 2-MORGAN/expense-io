import { describe, expect, it } from 'vitest'
import { generateToken, hashToken } from './tokens'

describe('jetons des liens', () => {
  it('32 octets aléatoires en base64url, jamais deux fois le même', () => {
    const first = generateToken()
    const second = generateToken()
    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(first.token).not.toBe(second.token)
  })
  it('seule l’empreinte SHA-256 est stockée, et elle se recalcule depuis le jeton', () => {
    const { token, hash } = generateToken()
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hashToken(token)).toBe(hash)
    expect(hash).not.toContain(token)
  })
})
