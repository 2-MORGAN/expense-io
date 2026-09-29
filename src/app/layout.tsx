import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { Geist, Geist_Mono } from 'next/font/google'
import Link from 'next/link'
import './globals.css'
import { auth } from '@/lib/auth'
import { logout } from '@/app/actions/auth'
import { NavItem } from '@/components/NavItem'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'Expense.io',
  description: 'Gestion des notes de frais',
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const session = await auth()

  return (
    <html lang="fr" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="min-h-full bg-gray-50 text-gray-900 antialiased dark:bg-gray-950 dark:text-gray-100">
        <header className="border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3 sm:px-6">
            <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
              <span className="flex size-7 items-center justify-center rounded-md bg-brand-600 text-sm text-white">
                €
              </span>
              Expense.io
            </Link>
            {session?.user && (
              <form action={logout} className="flex items-center gap-3">
                {session.user.role === 'manager' && (
                  <NavItem href="/manager" label="Manager" />
                )}
                {session.user.role === 'hr_admin' && (
                  <NavItem href="/hr" label="RH" />
                )}
                <span className="hidden text-sm text-gray-500 sm:inline dark:text-gray-400">
                  {session.user.email}
                </span>
                <button
                  type="submit"
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-100 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
                >
                  Se déconnecter
                </button>
              </form>
            )}
          </div>
        </header>
        <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">{children}</div>
      </body>
    </html>
  )
}
