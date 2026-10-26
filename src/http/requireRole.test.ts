import { describe, expect, it } from 'vitest'
import type { Session } from 'next-auth'
import { requireRole } from './requireRole'

const sessionAs = (role: 'employee' | 'manager' | 'hr_admin'): Session =>
  ({ user: { id: 'user-1', name: 'User', email: 'user@expense.io', role } }) as Session

describe('requireRole', () => {
  it('retourne 401 sans session', async () => {
    for (const session of [null, { user: undefined } as unknown as Session]) {
      const denied = requireRole(session, 'manager')
      expect(denied).toBeInstanceOf(Response)
      expect((denied as Response).status).toBe(401)
      expect(await (denied as Response).json()).toEqual({
        type: '/problems/authentication-required', title: 'Authentication required', status: 401,
        detail: 'Please sign in to continue.', code: 'AUTHENTICATION_REQUIRED',
        requestId: expect.any(String), error: 'Unauthorized',
      })
    }
  })

  it('retourne 403 si le rôle est refusé', async () => {
    const denied = requireRole(sessionAs('employee'), 'manager')
    expect(denied).toBeInstanceOf(Response)
    expect((denied as Response).status).toBe(403)
    expect(await (denied as Response).json()).toEqual({
      type: '/problems/forbidden', title: 'Forbidden', status: 403,
      detail: 'You are not allowed to perform this action.', code: 'FORBIDDEN',
      requestId: expect.any(String), error: 'Unauthorized',
    })
  })

  it("retourne l'utilisateur si le rôle est accepté", () => {
    expect(requireRole(sessionAs('manager'), 'manager')).toMatchObject({ id: 'user-1', role: 'manager' })
    expect(requireRole(sessionAs('hr_admin'), 'hr_admin')).toMatchObject({ role: 'hr_admin' })
  })

  it('sans rôle demandé, vérifie seulement la session', async () => {
    expect(requireRole(sessionAs('employee'))).toMatchObject({ id: 'user-1' })
    const denied = requireRole(null)
    expect(denied).toBeInstanceOf(Response)
    expect((denied as Response).status).toBe(401)
  })
})
