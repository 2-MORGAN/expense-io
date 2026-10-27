import { afterEach, describe, expect, it, vi } from 'vitest'

// S4 (ADR-001 §3 point 7, 2-481) : l'application et le worker refusent de
// démarrer en production sous un rôle qui contourne la RLS.

const currentDatabaseRole = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db', () => ({ currentDatabaseRole }))

import { checkDatabaseRole, databaseRoleVerdict } from '@/lib/dbRole'

const RESTRICTED = { name: 'expense_app', superuser: false, bypassRls: false }
const SUPERUSER = { name: 'expense', superuser: true, bypassRls: true }
const BYPASS_RLS = { name: 'expense_definer', superuser: false, bypassRls: true }

describe('databaseRoleVerdict', () => {
  it.each(['production', 'development', undefined])('rôle restreint : accepté (NODE_ENV=%s)', (nodeEnv) => {
    expect(databaseRoleVerdict(RESTRICTED, nodeEnv)).toBe('ok')
  })

  it.each([SUPERUSER, BYPASS_RLS])('$name en production : refusé', (role) => {
    expect(databaseRoleVerdict(role, 'production')).toBe('refuse')
  })

  it.each([SUPERUSER, BYPASS_RLS])('$name en développement : avertissement', (role) => {
    expect(databaseRoleVerdict(role, 'development')).toBe('warn')
  })
})

describe('checkDatabaseRole', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    currentDatabaseRole.mockReset()
  })

  it('production sous le superuser : lève, avec une ligne de journal sans secret', async () => {
    currentDatabaseRole.mockResolvedValue(SUPERUSER)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(checkDatabaseRole('web', 'production')).rejects.toThrow(/refusing to start/)
    expect(JSON.parse(error.mock.calls[0][0] as string)).toMatchObject({
      level: 'error', msg: 'db.role.refused', process: 'web', role: 'expense', superuser: true,
    })
  })

  it('développement sous le superuser : avertit et continue', async () => {
    currentDatabaseRole.mockResolvedValue(SUPERUSER)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(checkDatabaseRole('worker', 'development')).resolves.toBeUndefined()
    expect(JSON.parse(warn.mock.calls[0][0] as string)).toMatchObject({ msg: 'db.role.bypasses_rls', process: 'worker' })
  })

  it('rôle restreint : rien à signaler', async () => {
    currentDatabaseRole.mockResolvedValue(RESTRICTED)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(checkDatabaseRole('web', 'production')).resolves.toBeUndefined()
    expect(warn).not.toHaveBeenCalled()
  })

  it('base injoignable : lève en production, avertit en développement', async () => {
    currentDatabaseRole.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:5433'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(checkDatabaseRole('web', 'production')).rejects.toThrow(/ECONNREFUSED/)
    await expect(checkDatabaseRole('web', 'development')).resolves.toBeUndefined()
    expect(JSON.parse(warn.mock.calls[0][0] as string)).toMatchObject({ msg: 'db.role.unchecked' })
  })
})
