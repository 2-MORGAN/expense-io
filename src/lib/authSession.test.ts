import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Faille S9 (audit WS1, ADR-001 §4) : le rôle n'est plus figé dans le JWT, il
// est relu en base à chaque lecture de session ; un compte supprimé perd sa
// session ; la session expire après 8 h d'inactivité. On capture la
// configuration passée à NextAuth, sans base ni serveur.

const nextAuth = vi.hoisted(() => vi.fn((config: unknown) => ({ config })))
const loadSessionUser = vi.hoisted(() => vi.fn())
vi.mock('next-auth', () => ({ default: nextAuth }))
vi.mock('next-auth/providers/credentials', () => ({ default: vi.fn(() => ({})) }))
vi.mock('@/lib/db', () => ({ getPool: vi.fn() }))
vi.mock('@/lib/sessionUser', () => ({ loadSessionUser }))

interface Token {
  id?: unknown
  role?: unknown
}
interface AuthConfig {
  session: { strategy: string; maxAge: number }
  callbacks: { jwt: (params: { token: Token; user?: { id: string; role: string } }) => Promise<Token | null> }
}

let config: AuthConfig

describe('session Auth.js (S9)', () => {
  beforeAll(async () => {
    vi.stubEnv('AUTH_SECRET', 'secret-de-test-auth')
    await import('@/lib/auth')
    config = nextAuth.mock.calls[0][0] as AuthConfig
  })

  beforeEach(() => {
    loadSessionUser.mockReset()
  })

  it('expire après 8 h d’inactivité, pas 30 jours', () => {
    expect(config.session).toEqual({ strategy: 'jwt', maxAge: 8 * 60 * 60 })
  })

  it('le rôle vient de la base, pas du jeton : un manager rétrogradé redevient employé', async () => {
    loadSessionUser.mockResolvedValue({ role: 'employee' })
    const token = await config.callbacks.jwt({ token: { id: 'user-1', role: 'manager' } })
    expect(token).toMatchObject({ id: 'user-1', role: 'employee' })
    expect(loadSessionUser).toHaveBeenCalledWith('user-1')
  })

  it('compte supprimé → `null` : Auth.js efface le cookie', async () => {
    loadSessionUser.mockResolvedValue(null)
    await expect(config.callbacks.jwt({ token: { id: 'user-1', role: 'manager' } })).resolves.toBeNull()
  })

  it('jeton sans id → `null`, sans lecture en base', async () => {
    await expect(config.callbacks.jwt({ token: {} })).resolves.toBeNull()
    expect(loadSessionUser).not.toHaveBeenCalled()
  })

  it('erreur de base propagée : Auth.js efface le cookie (échec fermé)', async () => {
    const failure = new Error('base indisponible')
    loadSessionUser.mockRejectedValue(failure)
    await expect(config.callbacks.jwt({ token: { id: 'user-1', role: 'manager' } })).rejects.toBe(failure)
  })

  it('à la connexion, pose l’id puis relit le rôle en base', async () => {
    loadSessionUser.mockResolvedValue({ role: 'hr_admin' })
    const token = await config.callbacks.jwt({ token: {}, user: { id: 'user-2', role: 'employee' } })
    expect(token).toMatchObject({ id: 'user-2', role: 'hr_admin' })
    expect(loadSessionUser).toHaveBeenCalledWith('user-2')
  })
})
