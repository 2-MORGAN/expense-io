'use client'

import { useActionState } from 'react'
import { resendVerification, type AuthFormState } from '@/app/actions/auth'

const initialState: AuthFormState = {}

const inputClass =
  'w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 dark:border-gray-700 dark:bg-gray-900 dark:focus:ring-brand-900'

/** Renvoi de l'email de vérification du créateur d'entreprise (S7). */
export function ResendVerificationForm() {
  const [state, formAction, pending] = useActionState(resendVerification, initialState)

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-6 text-left shadow-sm dark:border-gray-800 dark:bg-gray-900"
    >
      <p className="text-sm text-gray-500 dark:text-gray-400">Email non reçu ou lien expiré ?</p>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="resend-email" className="text-sm font-medium">
          Email
        </label>
        <input id="resend-email" name="email" type="email" required className={inputClass} />
      </div>

      {state.notice && (
        <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800 dark:bg-green-950 dark:text-green-200">
          {state.notice}
        </p>
      )}
      {state.error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Envoi…' : "Renvoyer l'email"}
      </button>
    </form>
  )
}
