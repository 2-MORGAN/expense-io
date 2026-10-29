import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { AdminConsole } from './AdminConsole'
import type { CompanyUser, ExpenseNote } from '@/http/dto'
import { json, problem, stubFetch, type Route } from '../../integration/support/fetch'

// Espace RH rendu en entier (organigramme, invitations, notes des managers
// racine) avec la traduction des erreurs ; seul le réseau est simulé.

const marie: CompanyUser = { id: '00000000-0000-4000-8000-0000000000a1', name: 'Marie Manager', email: 'marie@acme.test', role: 'manager', managerId: null }
const olga: CompanyUser = { id: '00000000-0000-4000-8000-0000000000a2', name: 'Olga Racine', email: 'olga@acme.test', role: 'manager', managerId: null }
const emile: CompanyUser = { id: '00000000-0000-4000-8000-0000000000b1', name: 'Emile Employe', email: 'emile@acme.test', role: 'employee', managerId: marie.id }
const rootNote: ExpenseNote = {
  id: '00000000-0000-4000-8000-0000000000c1',
  userId: marie.id,
  amount: 1202,
  expenseDate: '2026-10-03',
  description: 'Salon professionnel',
  receiptKey: 'receipts/x/y.pdf',
  status: 'pending',
  createdAt: '2026-10-03T08:00:00.000Z',
}

const USERS = '/api/hr/users'
const NOTES = '/api/hr/expense-notes'

function renderWith(routes: Route[]) {
  const calls = stubFetch(routes)
  render(<AdminConsole />)
  return calls
}

const baseRoutes = (): Route[] => [
  { path: USERS, reply: () => json([emile, marie, olga]) },
  { path: NOTES, reply: () => json([rootNote]) },
]

describe('AdminConsole', () => {
  it('organigramme : chaque salarié avec son manager ; un manager ne se voit pas proposé pour lui-même', async () => {
    renderWith(baseRoutes())
    // Ancré sur nom et email : la ligne d'Emile cite aussi « Marie Manager » (son manager).
    const marieRow = await screen.findByRole('row', { name: /^Marie Manager marie@acme\.test/ })
    const options = within(within(marieRow).getByRole('combobox')).getAllByRole('option').map((option) => option.textContent)
    expect(options).toEqual(['— aucun (racine) —', 'Olga Racine'])
    const emileSelect = within(screen.getByRole('row', { name: /^Emile Employe/ })).getByRole('combobox') as HTMLSelectElement
    expect(emileSelect.value).toBe(marie.id)
    expect(screen.getByRole('heading', { name: 'Organigramme (3)' })).toBeTruthy()
  })

  it('les notes des managers racine portent le nom de leur auteur, montant et date en français', async () => {
    renderWith(baseRoutes())
    const row = await screen.findByRole('row', { name: /Salon professionnel/ })
    expect(within(row).getByText('Marie Manager')).toBeTruthy()
    expect(within(row).getByText('3 oct. 2026')).toBeTruthy()
    expect(within(row).getByText(/1\s202,00\s€/)).toBeTruthy()
  })

  it('changer de manager envoie le rattachement puis recharge l’organigramme ; « aucun » envoie null', async () => {
    const routes = baseRoutes()
    routes.push({ method: 'PUT', path: `${USERS}/${emile.id}/manager`, reply: () => json({ ...emile, managerId: olga.id }) })
    const calls = renderWith(routes)
    const select = within(await screen.findByRole('row', { name: /^Emile Employe/ })).getByRole('combobox')
    await userEvent.selectOptions(select, olga.id)
    await userEvent.selectOptions(select, '')
    const puts = calls.filter((call) => call.method === 'PUT').map((call) => JSON.parse(String(call.init.body)))
    expect(puts).toEqual([{ managerId: olga.id }, { managerId: null }])
    expect(calls.filter((call) => call.path === USERS)).toHaveLength(3)
  })

  it('rattachement refusé : message traduit d’INVALID_MANAGER dans l’organigramme', async () => {
    const routes = baseRoutes()
    routes.push({ method: 'PUT', path: `${USERS}/${emile.id}/manager`, reply: () => problem('INVALID_MANAGER', 409) })
    renderWith(routes)
    const select = within(await screen.findByRole('row', { name: /^Emile Employe/ })).getByRole('combobox')
    await userEvent.selectOptions(select, olga.id)
    expect((await screen.findByRole('alert')).textContent).toBe('Le manager sélectionné ne peut pas être affecté.')
  })

  it('organigramme en panne : son erreur s’affiche, les notes se chargent quand même', async () => {
    renderWith([
      { path: USERS, reply: () => problem('INTERNAL_ERROR', 500) },
      { path: NOTES, reply: () => json([rootNote]) },
    ])
    expect((await screen.findByRole('alert')).textContent).toBe('Une erreur est survenue. Réessaie plus tard.')
    expect(await screen.findByRole('row', { name: /Salon professionnel/ })).toBeTruthy()
  })

  it('« Rejeter » tranche la note de manager racine puis recharge les notes', async () => {
    const routes = baseRoutes()
    const calls = renderWith(routes)
    await screen.findByRole('row', { name: /Salon professionnel/ })
    routes.push(
      { method: 'POST', path: `${NOTES}/${rootNote.id}/reject`, reply: () => json({ ...rootNote, status: 'rejected' }) },
      { path: NOTES, reply: () => json([]) }
    )
    await userEvent.click(screen.getByRole('button', { name: 'Rejeter' }))
    expect(await screen.findByText('Aucune note en attente.')).toBeTruthy()
    expect(calls.some((call) => call.method === 'POST' && call.path === `${NOTES}/${rootNote.id}/reject`)).toBe(true)
  })
})
