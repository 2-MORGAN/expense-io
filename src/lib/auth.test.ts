import { afterEach, describe, expect, it, vi } from 'vitest'

// Faille S5 (audit WS1) : le secret de signature des sessions vient de
// l'environnement (12-Factor), jamais du code. On capture la configuration
// passée à NextAuth, sans base ni serveur.

const nextAuth = vi.hoisted(() => vi.fn(() => ({})))
vi.mock('next-auth', () => ({ default: nextAuth }))
vi.mock('next-auth/providers/credentials', () => ({ default: vi.fn(() => ({})) }))
vi.mock('@/lib/db', () => ({ getPool: vi.fn() }))

describe('configuration Auth.js', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
    nextAuth.mockClear()
  })

  it('signe les sessions avec AUTH_SECRET lu dans l’environnement', async () => {
    vi.stubEnv('AUTH_SECRET', 'secret-de-test-auth')
    await import('@/lib/auth')

    expect(nextAuth).toHaveBeenCalledOnce()
    expect(nextAuth.mock.calls[0]).toEqual([
      expect.objectContaining({ secret: 'secret-de-test-auth' }),
    ])
  })
})
