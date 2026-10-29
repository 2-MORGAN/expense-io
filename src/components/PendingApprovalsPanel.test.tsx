import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PendingApprovalsPanel } from './PendingApprovalsPanel'
import type { ExpenseNote } from '@/http/dto'
import { json, problem, stubFetch, type Route } from '../../integration/support/fetch'

// Écran de validation du manager rendu avec ses vrais enfants et sa
// traduction des erreurs ; seul le réseau est simulé. Les états de panne
// serveur, invisibles en E2E, se vérifient ici.

const note: ExpenseNote = {
  id: '11111111-2222-4333-8444-555555555555',
  userId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  amount: 42.5,
  expenseDate: '2026-10-01',
  description: 'Taxi aéroport',
  receiptKey: 'receipts/x/y.png',
  status: 'pending',
  createdAt: '2026-10-01T08:00:00.000Z',
}

const LIST = '/api/manager/expense-notes'

function renderWith(routes: Route[]) {
  const calls = stubFetch(routes)
  render(<PendingApprovalsPanel />)
  return calls
}

describe('PendingApprovalsPanel', () => {
  it('liste les notes en attente : auteur tronqué, date et montant en français, compteur', async () => {
    renderWith([{ path: LIST, reply: () => json([note]) }])
    const row = await screen.findByRole('row', { name: /Taxi aéroport/ })
    expect(within(row).getByText('aaaaaaaa…')).toBeTruthy()
    expect(within(row).getByText('1 oct. 2026')).toBeTruthy()
    expect(within(row).getByText('42,50 €')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'En attente (1)' })).toBeTruthy()
  })

  it('sans note : « Aucune note en attente. »', async () => {
    renderWith([{ path: LIST, reply: () => json([]) }])
    expect(await screen.findByText('Aucune note en attente.')).toBeTruthy()
  })

  it('« Approuver » envoie la décision puis recharge la liste', async () => {
    const routes: Route[] = [{ path: LIST, reply: () => json([note]) }]
    const calls = renderWith(routes)
    await screen.findByRole('row', { name: /Taxi aéroport/ })
    routes.push(
      { method: 'POST', path: `${LIST}/${note.id}/approve`, reply: () => json({ ...note, status: 'approved' }) },
      { path: LIST, reply: () => json([]) }
    )
    await userEvent.click(screen.getByRole('button', { name: 'Approuver' }))
    expect(await screen.findByText('Aucune note en attente.')).toBeTruthy()
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([`GET ${LIST}`, `POST ${LIST}/${note.id}/approve`, `GET ${LIST}`])
  })

  it('note déjà tranchée ailleurs : message traduit du code ALREADY_DECIDED, la note reste affichée', async () => {
    renderWith([
      { path: LIST, reply: () => json([note]) },
      { method: 'POST', path: `${LIST}/${note.id}/reject`, reply: () => problem('ALREADY_DECIDED', 409) },
    ])
    await userEvent.click(await screen.findByRole('button', { name: 'Rejeter' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Cette note a déjà été tranchée.')
    expect(screen.getByRole('row', { name: /Taxi aéroport/ })).toBeTruthy()
  })

  it('panne serveur au chargement : message générique en français, jamais le texte de l’API', async () => {
    renderWith([{ path: LIST, reply: () => problem('INTERNAL_ERROR', 500) }])
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('Une erreur est survenue. Réessaie plus tard.')
    expect(screen.queryByText(/Detail in English/)).toBeNull()
    expect(screen.getByText('Aucune note en attente.')).toBeTruthy()
  })

  it('code inconnu ou corps illisible : message générique', async () => {
    renderWith([{ path: LIST, reply: () => new Response('<html>proxy</html>', { status: 502 }) }])
    expect((await screen.findByRole('alert')).textContent).toBe('Une erreur est survenue. Réessaie plus tard.')
  })

  it('« Voir le reçu » ouvre l’URL pré-signée dans un nouvel onglet ; un 404 s’affiche traduit', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const routes: Route[] = [
      { path: LIST, reply: () => json([note]) },
      { path: `${LIST}/${note.id}/receipt-url`, reply: () => json({ url: 'https://s3.test/recu.png' }) },
    ]
    renderWith(routes)
    await userEvent.click(await screen.findByRole('button', { name: 'Voir le reçu' }))
    expect(open).toHaveBeenCalledWith('https://s3.test/recu.png', '_blank', 'noopener,noreferrer')

    routes.push({ path: `${LIST}/${note.id}/receipt-url`, reply: () => problem('RESOURCE_NOT_FOUND', 404) })
    await userEvent.click(screen.getByRole('button', { name: 'Voir le reçu' }))
    expect((await screen.findByRole('alert')).textContent).toBe('La ressource demandée est introuvable.')
    expect(open).toHaveBeenCalledTimes(1)
  })
})
