'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { signup, type AuthFormState } from '@/app/actions/auth'

const initialState: AuthFormState = {}

const inputClass =
  'w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 dark:border-gray-700 dark:bg-gray-900 dark:focus:ring-brand-900'

export default function SignupPage() {
  const [state, formAction, pending] = useActionState(signup, initialState)

  return (
    <main className="mx-auto flex max-w-sm flex-col gap-6 pt-8">
      <div className="space-y-1 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Créer un compte</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Quelques secondes suffisent.
        </p>
      </div>

      <form
        action={formAction}
        className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900"
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor="name" className="text-sm font-medium">
            Nom
          </label>
          <input id="name" name="name" type="text" required className={inputClass} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="text-sm font-medium">
            Email
          </label>
          <input id="email" name="email" type="email" required className={inputClass} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="password" className="text-sm font-medium">
            Mot de passe
          </label>
          <input
            id="password"
            name="password"
            type="password"
            minLength={8}
            required
            className={inputClass}
          />
          <p className="text-xs text-gray-400">8 caractères minimum.</p>
        </div>

        {state?.error && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {state.error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="mt-1 w-full rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? 'Création…' : "S'inscrire"}
        </button>
      </form>

      <p className="text-center text-sm text-gray-500 dark:text-gray-400">
        Déjà un compte ?{' '}
        <Link href="/login" className="font-medium text-brand-600 hover:underline">
          Se connecter
        </Link>
      </p>
    </main>
  )
}
