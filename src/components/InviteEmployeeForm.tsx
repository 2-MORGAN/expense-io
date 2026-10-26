'use client'

import { useState, type FormEvent } from 'react'

const inputClass =
  'w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 dark:border-gray-700 dark:bg-gray-900 dark:focus:ring-brand-900'

/** Invitation d'un salarié par la RH (S7) : seul moyen de rejoindre l'entreprise. */
export function InviteEmployeeForm() {
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSending(true)
    setError(null)
    setSentTo(null)
    const response = await fetch('/api/hr/invitations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    setSending(false)
    if (response.ok) {
      const invitation = (await response.json()) as { email: string }
      setSentTo(invitation.email)
      setEmail('')
    } else {
      setError(response.status === 400 ? 'Adresse email invalide.' : "L'invitation n'a pas pu être envoyée.")
    }
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <h2 className="border-b border-gray-200 px-6 py-4 text-base font-semibold dark:border-gray-800">
        Inviter un salarié
      </h2>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-end">
        <div className="flex flex-1 flex-col gap-1.5">
          <label htmlFor="invite-email" className="text-sm font-medium">
            Email du salarié
          </label>
          <input
            id="invite-email"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={inputClass}
          />
        </div>
        <button
          type="submit"
          disabled={sending}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {sending ? 'Envoi…' : "Envoyer l'invitation"}
        </button>
      </form>
      {sentTo && (
        <p role="status" className="mx-6 mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800 dark:bg-green-950 dark:text-green-200">
          Invitation envoyée à {sentTo}.
        </p>
      )}
      {error && (
        <p role="alert" className="mx-6 mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}
    </section>
  )
}
