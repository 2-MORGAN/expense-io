import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { PostgresCompanyDirectory } from './PostgresCompanyDirectory'
import { addMember, createTenant, owner } from '../../../../integration/support/tenant'

// Organigramme sous le contexte de la RH : les policies de `users` bornent la
// lecture et le rattachement à son entreprise ; l'adaptateur garde en plus
// ses conditions sur l'entreprise (défense en profondeur, ADR-001 §3).

const directory = new PostgresCompanyDirectory()

const managerOf = async (userId: string) =>
  (await owner().query<{ manager_id: string | null }>('SELECT manager_id FROM users WHERE id = $1', [userId])).rows[0]
    .manager_id

describe('listMembers', () => {
  it('rend employés et managers de l’entreprise, sans la RH, triés par nom puis id', async () => {
    const tenant = await createTenant('annuaire')
    const twinA = await addMember(tenant.company, { name: 'Alex Homonyme', role: 'employee' })
    const twinB = await addMember(tenant.company, { name: 'Alex Homonyme', role: 'employee' })
    await createTenant('annuaire-autre')
    const members = await directory.listMembers(tenant.hr.id)
    const twins = [twinA.id, twinB.id].sort()
    expect(members.map((member) => member.id)).toEqual([...twins, tenant.employee.id, tenant.manager.id])
    expect(members.find((member) => member.id === tenant.employee.id)).toEqual({
      id: tenant.employee.id,
      name: 'Emile Employe',
      email: tenant.employee.email,
      role: 'employee',
      managerId: tenant.manager.id,
    })
  })

  it('un utilisateur inconnu ne voit personne', async () => {
    expect(await directory.listMembers(randomUUID())).toEqual([])
  })
})

describe('assignManager', () => {
  it('rattache un employé à un manager de l’entreprise et rend la ligne à jour', async () => {
    const tenant = await createTenant('rattachement')
    const other = await addMember(tenant.company, { name: 'Olga Racine', role: 'manager' })
    const result = await directory.assignManager(tenant.hr.id, tenant.employee.id, other.id)
    expect(result).toEqual({ kind: 'assigned', user: expect.objectContaining({ id: tenant.employee.id, managerId: other.id }) })
    expect(await managerOf(tenant.employee.id)).toBe(other.id)
  })

  it('managerId null détache (manager racine)', async () => {
    const tenant = await createTenant('detachement')
    const result = await directory.assignManager(tenant.hr.id, tenant.employee.id, null)
    expect(result).toMatchObject({ kind: 'assigned', user: { managerId: null } })
    expect(await managerOf(tenant.employee.id)).toBeNull()
  })

  it.each(['soi-même', 'un employé', 'une RH', 'un id inconnu', 'un manager d’une autre entreprise'] as const)(
    'refuse comme manager %s (invalid_manager), rattachement inchangé',
    async (candidate) => {
      const tenant = await createTenant('rattachement-invalide')
      const colleague = await addMember(tenant.company, { name: 'Clara Collegue', role: 'employee' })
      const managerId = {
        'soi-même': tenant.employee.id,
        'un employé': colleague.id,
        'une RH': tenant.hr.id,
        'un id inconnu': randomUUID(),
        'un manager d’une autre entreprise': (await createTenant('rattachement-b')).manager.id,
      }[candidate]
      expect(await directory.assignManager(tenant.hr.id, tenant.employee.id, managerId)).toEqual({ kind: 'invalid_manager' })
      expect(await managerOf(tenant.employee.id)).toBe(tenant.manager.id)
    }
  )

  it.each(['la RH elle-même', 'un salarié d’une autre entreprise', 'un id inconnu'] as const)(
    'cible %s : not_found',
    async (target) => {
      const tenant = await createTenant('rattachement-cible')
      const userId = {
        'la RH elle-même': tenant.hr.id,
        'un salarié d’une autre entreprise': (await createTenant('rattachement-cible-b')).employee.id,
        'un id inconnu': randomUUID(),
      }[target]
      expect(await directory.assignManager(tenant.hr.id, userId, tenant.manager.id)).toEqual({ kind: 'not_found' })
    }
  )

  it('un manager rétrogradé pendant le rattachement est refusé après l’attente du verrou (FOR SHARE)', async () => {
    const tenant = await createTenant('rattachement-concurrent')
    const candidate = await addMember(tenant.company, { name: 'Olga Racine', role: 'manager' })
    const demotion = await owner().connect()
    try {
      await demotion.query('BEGIN')
      await demotion.query("UPDATE users SET role = 'employee' WHERE id = $1", [candidate.id])
      const assignment = directory.assignManager(tenant.hr.id, tenant.employee.id, candidate.id)
      // Le rattachement attend le verrou de la ligne du manager, puis relit son rôle.
      await expect.poll(
        async () =>
          (
            await owner().query<{ waiting: number }>(
              "SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%FOR SHARE%' AND query LIKE '%role = ''manager''%'"
            )
          ).rows[0].waiting,
        { timeout: 10_000 }
      ).toBeGreaterThan(0)
      await demotion.query('COMMIT')
      expect(await assignment).toEqual({ kind: 'invalid_manager' })
    } finally {
      demotion.release()
    }
    expect(await managerOf(tenant.employee.id)).toBe(tenant.manager.id)
  })
})
