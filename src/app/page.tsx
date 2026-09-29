import Link from 'next/link'
import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'

export default async function Home() {
  const session = await auth()
  if (session?.user) {
    redirect('/expenses')
  }

  return (
    <main className="flex flex-col items-center gap-6 py-16 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-brand-600 text-2xl text-white shadow-sm">
        €
      </span>
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Expense.io</h1>
        <p className="max-w-md text-gray-600 dark:text-gray-400">
          Gestion de notes de frais.
        </p>
      </div>
      <div className="flex gap-3">
        <Link
          href="/login"
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700"
        >
          Se connecter
        </Link>
        <Link
          href="/signup"
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          Créer un compte
        </Link>
      </div>
    </main>
  )
}
