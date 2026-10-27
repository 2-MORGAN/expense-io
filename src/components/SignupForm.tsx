'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { signup, type AuthFormState } from '@/app/actions/auth'

const initialState: AuthFormState = {}

const inputClass =
  'w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 read-only:bg-gray-50 read-only:text-gray-500 dark:border-gray-700 dark:bg-gray-900 dark:focus:ring-brand-900 dark:read-only:bg-gray-800'

export interface SignupInvitation {
  token: string
  email: string
  companyName: string
}

/**
 * Formulaire d'inscription. Avec une invitation valide, l'adresse est celle
 * de l'invitation et le compte rejoint l'entreprise de la RH (S7).
 */
export function SignupForm({
  invitation,
  invitationInvalid = false,
}: {
  invitation?: SignupInvitation
  invitationInvalid?: boolean
}) {
  const [state, formAction, pending] = useActionState(signup, initialState)

  return (
    <main className="mx-auto flex max-w-sm flex-col gap-6 pt-8">
      <div className="space-y-1 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Créer un compte</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {invitation ? (
            <>
              Vous rejoignez <strong>{invitation.companyName}</strong>.
            </>
          ) : (
            'Quelques secondes suffisent.'
          )}
        </p>
      </div>

      {invitationInvalid && (
        <p role="alert" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          Invitation invalide ou expirée. Demandez une nouvelle invitation à vos RH, ou créez le
          compte de votre propre entreprise.
        </p>
      )}

      <form
        action={formAction}
        className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900"
      >
        {invitation && <input type="hidden" name="invitation" value={invitation.token} />}
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
          <input
            id="email"
            name="email"
            type="email"
            required
            readOnly={invitation !== undefined}
            defaultValue={invitation?.email}
            className={inputClass}
          />
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
