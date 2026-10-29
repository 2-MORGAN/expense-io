import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { NavItem } from './NavItem'

// Lien actif de la navigation : la page courante et ses sous-pages, pas un
// préfixe qui ne serait qu'un début de nom.

const pathname = vi.hoisted(() => ({ current: '/' }))
vi.mock('next/navigation', () => ({ usePathname: () => pathname.current }))

describe('NavItem', () => {
  it.each([
    ['/hr', 'page'],
    ['/hr/invitations', 'page'],
    ['/hrx', null],
    ['/manager', null],
  ])('sur %s, le lien « RH » vers /hr a aria-current=%s', (current, expected) => {
    pathname.current = current
    render(<NavItem href="/hr" label="RH" />)
    const link = screen.getByRole('link', { name: 'RH' })
    expect(link.getAttribute('href')).toBe('/hr')
    expect(link.getAttribute('aria-current')).toBe(expected)
  })
})
