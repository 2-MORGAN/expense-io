import { describe, expect, it } from 'vitest'
import { User, type UserRole } from '@/domain/User'

// Qui peut valider les notes de qui : un manager valide celles de ses
// subordonnés directs, un manager racine (sans manager) est validé par la RH.

const userWith = (id: string, role: UserRole, managerId: string | null): User =>
  new User({ id, email: `${id}@expense.io`, name: id, role, managerId })

describe('User', () => {
  describe('isRootManager', () => {
    it('est vrai pour un manager sans manager', () => {
      expect(userWith('m1', 'manager', null).isRootManager()).toBe(true)
    })

    it('est faux pour un manager rattaché à un autre manager', () => {
      expect(userWith('m2', 'manager', 'm1').isRootManager()).toBe(false)
    })

    it.each<UserRole>(['employee', 'hr_admin'])('est faux pour le rôle %s', (role) => {
      expect(userWith('u1', role, null).isRootManager()).toBe(false)
    })
  })

  describe('canManage', () => {
    const manager = userWith('m1', 'manager', null)

    it('est vrai pour un subordonné direct', () => {
      expect(manager.canManage(userWith('e1', 'employee', 'm1'))).toBe(true)
    })

    it('est faux pour un employé d’un autre manager', () => {
      expect(manager.canManage(userWith('e2', 'employee', 'm2'))).toBe(false)
    })

    it('est faux pour un employé sans manager', () => {
      expect(manager.canManage(userWith('e3', 'employee', null))).toBe(false)
    })

    it.each<UserRole>(['employee', 'hr_admin'])(
      'est faux si l’appelant a le rôle %s, même pour son rattaché',
      (role) => {
        expect(userWith('m1', role, null).canManage(userWith('e1', 'employee', 'm1'))).toBe(false)
      }
    )
  })
})
