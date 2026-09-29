'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export function NavItem({ href, label }: { href: string; label: string }) {
  const pathname = usePathname()
  const isActive = pathname === href || pathname.startsWith(`${href}/`)

  return (
    <Link
      href={href}
      aria-current={isActive ? 'page' : undefined}
      className={
        isActive
          ? 'rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm'
          : 'rounded-md px-3 py-1.5 text-sm font-medium text-gray-700 transition hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800'
      }
    >
      {label}
    </Link>
  )
}
