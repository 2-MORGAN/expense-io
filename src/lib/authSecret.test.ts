import { afterEach, describe, expect, it, vi } from 'vitest'
import { authSecretProblem, checkAuthSecret, EXAMPLE_AUTH_SECRET } from './authSecret'

// CONF-01 (S5, ADR-001 §4 point 1) : secret de session absent, trop court ou
// égal à la valeur d'exemple → refus de démarrer en production.

const strong = 'Zq3v9mK2pX7rT1wB8nL4sD6fH0jG5cYa'

describe('AUTH_SECRET au démarrage (CONF-01)', () => {
  afterEach(() => vi.restoreAllMocks())

  it('repère un secret absent, vide, d’exemple ou trop court', () => {
    expect(authSecretProblem(undefined)).toBe('missing')
    expect(authSecretProblem('   ')).toBe('missing')
    expect(authSecretProblem(EXAMPLE_AUTH_SECRET)).toBe('example')
    expect(authSecretProblem('changeme')).toBe('example')
    expect(authSecretProblem('secret-de-31-caracteres-exactem')).toBe('too_short')
    expect(authSecretProblem(strong)).toBeNull()
  })

  it('production : refus de démarrer, sans écrire le secret dans le journal', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => checkAuthSecret(EXAMPLE_AUTH_SECRET, 'production')).toThrow(/AUTH_SECRET is unusable \(example\)/)
    expect(() => checkAuthSecret(undefined, 'production')).toThrow(/missing/)
    expect(error.mock.calls.flat().join(' ')).not.toContain(EXAMPLE_AUTH_SECRET)
  })

  it('développement : avertissement seulement', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => checkAuthSecret('court', 'development')).not.toThrow()
    expect(JSON.parse(warn.mock.calls[0][0] as string)).toMatchObject({ msg: 'auth.secret.weak', problem: 'too_short' })
  })

  it('secret solide : rien à signaler, en production comme en développement', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => checkAuthSecret(strong, 'production')).not.toThrow()
    expect(warn).not.toHaveBeenCalled()
  })
})
