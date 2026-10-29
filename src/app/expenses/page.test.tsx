import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import ExpensesPage from './page'
import type { ExpenseNote } from '@/http/dto'
import { json, problem, stubFetch, type Call, type Route } from '../../../integration/support/fetch'

// Page « Mes notes de frais » rendue en entier : formulaire, pré-remplissage
// depuis le reçu (OCR asynchrone), historique et erreurs traduites. Seul le
// réseau est simulé : la clé d'idempotence d'un renvoi et les pannes serveur,
// difficiles à provoquer en E2E, se vérifient ici.

const NOTES = '/api/expense-notes'
const ANALYSES = '/api/receipt-analyses'
const ANALYSIS_ID = '00000000-0000-4000-8000-00000000000a'

function note(overrides: Partial<ExpenseNote>): ExpenseNote {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    userId: '00000000-0000-4000-8000-0000000000ff',
    amount: 42.5,
    expenseDate: '2026-10-01',
    description: 'Taxi aéroport',
    receiptKey: 'receipts/x/y.png',
    status: 'pending',
    createdAt: '2026-10-01T08:00:00.000Z',
    ...overrides,
  }
}

const receiptFile = () => new File([new Uint8Array([137, 80, 78, 71])], 'recu.png', { type: 'image/png' })

function renderWith(routes: Route[]): Call[] {
  const calls = stubFetch(routes)
  render(<ExpensesPage />)
  return calls
}

async function fillForm(fields: { amount?: string; date?: string; description?: string; receipt?: boolean } = {}) {
  if (fields.amount !== undefined) await userEvent.type(screen.getByLabelText('Montant (€)'), fields.amount)
  // Un champ date ne se tape pas caractère par caractère dans jsdom : valeur posée d'un coup.
  if (fields.date !== undefined) fireEvent.change(screen.getByLabelText('Date'), { target: { value: fields.date } })
  if (fields.description !== undefined) await userEvent.type(screen.getByLabelText('Description'), fields.description)
  if (fields.receipt) await userEvent.upload(screen.getByLabelText('Reçu (image ou PDF)'), receiptFile())
}

const header = (call: Call, name: string) => new Headers(call.init.headers).get(name)

// jsdom ignore le fichier joint par user-event quand il contrôle `required` :
// le formulaire resterait invalide. L'événement submit est donc envoyé
// directement ; la validation du reçu est couverte par les tests
// d'intégration de la route (integration/api-expense-notes.integration.test.ts).
const submit = () => fireEvent.submit(screen.getByRole('button', { name: 'Soumettre' }).closest('form')!)

const posts = (calls: Call[]) => calls.filter((call) => call.method === 'POST')

describe('historique', () => {
  it('sans note : invitation à soumettre, historique vide', async () => {
    renderWith([{ path: NOTES, reply: () => json([]) }])
    expect(await screen.findByText('Aucune note de frais pour le moment.')).toBeTruthy()
    expect(screen.getByText('Soumets ta première note de frais ci-dessous.')).toBeTruthy()
  })

  it('compteur, total et statuts en français', async () => {
    renderWith([
      {
        path: NOTES,
        reply: () =>
          json([
            note({ id: '00000000-0000-4000-8000-000000000002', amount: 1202, description: 'Salon', status: 'approved' }),
            note({ amount: 42.5, status: 'rejected' }),
          ]),
      },
    ])
    expect(await screen.findByText(/2 notes · 1\s244,50\s€ au total/)).toBeTruthy()
    expect(within(screen.getByRole('row', { name: /Salon/ })).getByText('approuvée')).toBeTruthy()
    expect(within(screen.getByRole('row', { name: /Taxi aéroport/ })).getByText('rejetée')).toBeTruthy()
  })

  it('panne serveur au chargement : message générique en français', async () => {
    renderWith([{ path: NOTES, reply: () => problem('INTERNAL_ERROR', 500) }])
    expect((await screen.findByRole('alert')).textContent).toBe('Une erreur est survenue. Réessaie plus tard.')
  })
})

describe('soumission', () => {
  it('envoie le formulaire avec une clé d’idempotence, vide le formulaire et recharge l’historique', async () => {
    const routes: Route[] = [
      { path: NOTES, reply: () => json([]) },
      { method: 'POST', path: NOTES, reply: () => json(note({}), 201) },
    ]
    const calls = renderWith(routes)
    await screen.findByText('Aucune note de frais pour le moment.')
    await fillForm({ amount: '42.5', date: '2026-10-01', description: 'Taxi aéroport', receipt: true })
    routes.push({ path: NOTES, reply: () => json([note({})]) })
    submit()

    expect(await screen.findByRole('row', { name: /Taxi aéroport/ })).toBeTruthy()
    const [post] = posts(calls)
    expect(header(post, 'Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/)
    const body = post.init.body as FormData
    expect([body.get('amount'), body.get('expenseDate'), body.get('description')]).toEqual(['42.5', '2026-10-01', 'Taxi aéroport'])
    expect((screen.getByLabelText('Description') as HTMLInputElement).value).toBe('')
  })

  it('un renvoi après une erreur réutilise la même clé : jamais de doublon (ADR-003 §4)', async () => {
    const routes: Route[] = [
      { path: NOTES, reply: () => json([]) },
      { method: 'POST', path: NOTES, reply: () => problem('INTERNAL_ERROR', 500) },
    ]
    const calls = renderWith(routes)
    await screen.findByText('Aucune note de frais pour le moment.')
    await fillForm({ amount: '10', date: '2026-10-02', description: 'Parking', receipt: true })
    submit()
    expect((await screen.findByRole('alert')).textContent).toBe('Une erreur est survenue. Réessaie plus tard.')

    routes.push({ method: 'POST', path: NOTES, reply: () => json(note({ description: 'Parking' }), 201) })
    submit()
    await waitFor(() => expect(posts(calls)).toHaveLength(2))
    const [first, retry] = posts(calls).map((call) => header(call, 'Idempotency-Key'))
    expect(retry).toBe(first)
  })

  it('formulaire modifié après un échec (422 IDEMPOTENCY_KEY_REUSED) : renvoi automatique avec une nouvelle clé', async () => {
    let firstKey: string | null = null
    const calls = renderWith([
      { path: NOTES, reply: () => json([]) },
      {
        method: 'POST',
        path: NOTES,
        reply: (init) => {
          const key = new Headers(init.headers).get('Idempotency-Key')
          firstKey ??= key
          return key === firstKey ? problem('IDEMPOTENCY_KEY_REUSED', 422) : json(note({}), 201)
        },
      },
    ])
    await screen.findByText('Aucune note de frais pour le moment.')
    await fillForm({ amount: '10', date: '2026-10-02', description: 'Parking', receipt: true })
    submit()
    await waitFor(() => expect(calls.filter((call) => call.path === NOTES && call.method === 'GET')).toHaveLength(2))
    const [first, second] = posts(calls).map((call) => header(call, 'Idempotency-Key'))
    expect(second).not.toBe(first)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('reçu refusé par l’API : message traduit du code, formulaire conservé', async () => {
    renderWith([
      { path: NOTES, reply: () => json([]) },
      { method: 'POST', path: NOTES, reply: () => problem('RECEIPT_TYPE_NOT_ALLOWED', 400) },
    ])
    await screen.findByText('Aucune note de frais pour le moment.')
    await fillForm({ amount: '10', date: '2026-10-02', description: 'Parking', receipt: true })
    submit()
    expect((await screen.findByRole('alert')).textContent).toBe('Type de fichier non autorisé pour le reçu')
    expect((screen.getByLabelText('Description') as HTMLInputElement).value).toBe('Parking')
  })
})

describe('pré-remplissage depuis le reçu', () => {
  const analysisRoutes = (result: Record<string, unknown>): Route[] => [
    { path: NOTES, reply: () => json([]) },
    { method: 'POST', path: ANALYSES, reply: () => json({ id: ANALYSIS_ID, status: 'queued' }, 202) },
    { path: `${ANALYSES}/${ANALYSIS_ID}`, reply: () => json({ id: ANALYSIS_ID, status: 'succeeded', result }) },
  ]

  it('sans reçu sélectionné : « Sélectionne d’abord un reçu. », aucun appel', async () => {
    const calls = renderWith([{ path: NOTES, reply: () => json([]) }])
    await screen.findByText('Aucune note de frais pour le moment.')
    await userEvent.click(screen.getByRole('button', { name: 'Pré-remplir depuis le reçu' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Sélectionne d’abord un reçu.')
    expect(calls.map((call) => call.path)).toEqual([NOTES])
  })

  it('remplit montant, date et description vide depuis l’analyse', async () => {
    renderWith(analysisRoutes({ amount: 42.5, expenseDate: '2026-10-11', description: 'Restaurant le Test' }))
    await screen.findByText('Aucune note de frais pour le moment.')
    await fillForm({ receipt: true })
    await userEvent.click(screen.getByRole('button', { name: 'Pré-remplir depuis le reçu' }))
    expect(await screen.findByDisplayValue('Restaurant le Test')).toBeTruthy()
    expect((screen.getByLabelText('Montant (€)') as HTMLInputElement).value).toBe('42.5')
    expect((screen.getByLabelText('Date') as HTMLInputElement).value).toBe('2026-10-11')
  })

  it('ne remplace pas une description déjà saisie', async () => {
    renderWith(analysisRoutes({ amount: 12.3, expenseDate: '2026-10-11', description: 'Restaurant le Test' }))
    await screen.findByText('Aucune note de frais pour le moment.')
    await fillForm({ description: 'Déjeuner client', receipt: true })
    await userEvent.click(screen.getByRole('button', { name: 'Pré-remplir depuis le reçu' }))
    expect(await screen.findByDisplayValue('12.3')).toBeTruthy()
    expect((screen.getByLabelText('Description') as HTMLInputElement).value).toBe('Déjeuner client')
  })

  it.each([
    [{ amount: 12.3 }, 'Date non reconnu(e) sur ce reçu — vérifie ce champ.'],
    [{ expenseDate: '2026-10-11' }, 'Montant non reconnu(e) sur ce reçu — vérifie ce champ.'],
    [{}, 'Aucune information reconnue sur ce reçu — saisis les champs manuellement.'],
  ])('résultat partiel %j : « %s »', async (result, notice) => {
    renderWith(analysisRoutes(result))
    await screen.findByText('Aucune note de frais pour le moment.')
    await fillForm({ receipt: true })
    await userEvent.click(screen.getByRole('button', { name: 'Pré-remplir depuis le reçu' }))
    expect(await screen.findByText(notice)).toBeTruthy()
  })

  it('OCR indisponible (503) : « Impossible d’analyser ce reçu. », bouton de nouveau actif', async () => {
    renderWith([
      { path: NOTES, reply: () => json([]) },
      { method: 'POST', path: ANALYSES, reply: () => problem('OCR_UNAVAILABLE', 503) },
    ])
    await screen.findByText('Aucune note de frais pour le moment.')
    await fillForm({ receipt: true })
    await userEvent.click(screen.getByRole('button', { name: 'Pré-remplir depuis le reçu' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Impossible d’analyser ce reçu.')
    expect((screen.getByRole('button', { name: 'Pré-remplir depuis le reçu' }) as HTMLButtonElement).disabled).toBe(false)
  })
})
