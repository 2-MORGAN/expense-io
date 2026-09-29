'use client'

import { useCallback, useEffect, useState } from 'react'

interface CompanyUser {
  id: string
  name: string
  email: string
  role: 'employee' | 'manager'
  managerId: string | null
}

interface ExpenseNote {
  id: string
  userId: string
  amount: number
  expenseDate: string
  description: string
  createdAt: string
}

const selectClass =
  'rounded-md border border-gray-300 px-2 py-1.5 text-sm shadow-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 dark:border-gray-700 dark:bg-gray-900 dark:focus:ring-brand-900'

const currencyFormatter = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
})

const dateFormatter = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' })

export function AdminConsole() {
  const [users, setUsers] = useState<CompanyUser[]>([])
  const [usersLoading, setUsersLoading] = useState(true)
  const [usersError, setUsersError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)

  const [notes, setNotes] = useState<ExpenseNote[]>([])
  const [notesLoading, setNotesLoading] = useState(true)
  const [notesError, setNotesError] = useState<string | null>(null)
  const [decidingId, setDecidingId] = useState<string | null>(null)

  const loadUsers = useCallback(async () => {
    const response = await fetch('/api/hr/users')
    if (response.ok) {
      setUsers(await response.json())
    } else {
      setUsersError("Impossible de charger l'annuaire.")
    }
    setUsersLoading(false)
  }, [])

  const loadNotes = useCallback(async () => {
    const response = await fetch('/api/hr/expense-notes')
    if (response.ok) {
      setNotes(await response.json())
    } else {
      setNotesError('Impossible de charger les notes en attente.')
    }
    setNotesLoading(false)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadUsers()
    loadNotes()
  }, [loadUsers, loadNotes])

  const managers = users.filter((user) => user.role === 'manager')

  async function handleManagerChange(userId: string, managerId: string) {
    setSavingId(userId)
    setUsersError(null)
    const response = await fetch(`/api/hr/users/${userId}/manager`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ managerId: managerId === '' ? null : managerId }),
    })
    setSavingId(null)

    if (response.ok) {
      await loadUsers()
    } else {
      const body = await response.json().catch(() => null)
      setUsersError(
        typeof body?.error === 'string' ? body.error : "Échec de l'assignation."
      )
    }
  }

  async function handleViewReceipt(id: string) {
    setNotesError(null)
    const response = await fetch(`/api/hr/expense-notes/${id}/receipt-url`)
    if (!response.ok) {
      setNotesError('Impossible de récupérer le reçu.')
      return
    }
    const { url } = await response.json()
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  async function handleDecide(id: string, decision: 'approve' | 'reject') {
    setDecidingId(id)
    setNotesError(null)
    const response = await fetch(`/api/hr/expense-notes/${id}/${decision}`, {
      method: 'POST',
    })
    setDecidingId(null)

    if (response.ok) {
      await loadNotes()
    } else {
      const body = await response.json().catch(() => null)
      setNotesError(
        typeof body?.error === 'string'
          ? body.error
          : 'Échec de la décision sur cette note de frais.'
      )
    }
  }

  return (
    <main className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Espace RH</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Organigramme de votre entreprise et validation des notes de frais
          des managers sans manager assigné.
        </p>
      </div>

      <section className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <h2 className="border-b border-gray-200 px-6 py-4 text-base font-semibold dark:border-gray-800">
          Organigramme ({users.length})
        </h2>
        {usersError && (
          <p role="alert" className="mx-6 mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {usersError}
          </p>
        )}
        {usersLoading ? (
          <p className="px-6 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
            Chargement…
          </p>
        ) : users.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
            Aucun employé ou manager dans cette entreprise.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500 dark:border-gray-800 dark:text-gray-400">
                  <th className="px-6 py-3 font-medium">Nom</th>
                  <th className="px-6 py-3 font-medium">Rôle</th>
                  <th className="px-6 py-3 font-medium">Manager</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {users.map((user) => (
                  <tr key={user.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <td className="px-6 py-3">
                      <div className="font-medium">{user.name}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">{user.email}</div>
                    </td>
                    <td className="px-6 py-3 capitalize">{user.role}</td>
                    <td className="px-6 py-3">
                      <select
                        value={user.managerId ?? ''}
                        disabled={savingId === user.id}
                        onChange={(event) => handleManagerChange(user.id, event.target.value)}
                        className={selectClass}
                      >
                        <option value="">— aucun (racine) —</option>
                        {managers
                          .filter((manager) => manager.id !== user.id)
                          .map((manager) => (
                            <option key={manager.id} value={manager.id}>
                              {manager.name}
                            </option>
                          ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <h2 className="border-b border-gray-200 px-6 py-4 text-base font-semibold dark:border-gray-800">
          Notes des managers racine en attente ({notes.length})
        </h2>
        {notesError && (
          <p role="alert" className="mx-6 mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {notesError}
          </p>
        )}
        {notesLoading ? (
          <p className="px-6 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
            Chargement…
          </p>
        ) : notes.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
            Aucune note en attente.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500 dark:border-gray-800 dark:text-gray-400">
                  <th className="px-6 py-3 font-medium">Manager</th>
                  <th className="px-6 py-3 font-medium">Date</th>
                  <th className="px-6 py-3 font-medium">Description</th>
                  <th className="px-6 py-3 text-right font-medium">Montant</th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {notes.map((note) => {
                  const author = users.find((user) => user.id === note.userId)
                  return (
                    <tr key={note.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                      <td className="px-6 py-3">{author?.name ?? note.userId.slice(0, 8)}</td>
                      <td className="px-6 py-3 whitespace-nowrap text-gray-500 dark:text-gray-400">
                        {dateFormatter.format(new Date(note.expenseDate))}
                      </td>
                      <td className="px-6 py-3">{note.description}</td>
                      <td className="px-6 py-3 text-right font-medium whitespace-nowrap">
                        {currencyFormatter.format(note.amount)}
                      </td>
                      <td className="px-6 py-3 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => handleViewReceipt(note.id)}
                          className="mr-3 text-sm font-medium text-brand-600 hover:underline"
                        >
                          Voir le reçu
                        </button>
                        <button
                          type="button"
                          disabled={decidingId === note.id}
                          onClick={() => handleDecide(note.id, 'approve')}
                          className="mr-3 text-sm font-medium text-green-600 hover:underline disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Approuver
                        </button>
                        <button
                          type="button"
                          disabled={decidingId === note.id}
                          onClick={() => handleDecide(note.id, 'reject')}
                          className="text-sm font-medium text-red-600 hover:underline disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Rejeter
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  )
}
