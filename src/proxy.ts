import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'

const PROTECTED_PREFIXES = ['/expenses', '/manager', '/hr']

export default auth((req) => {
  const isProtected = PROTECTED_PREFIXES.some((prefix) =>
    req.nextUrl.pathname.startsWith(prefix)
  )
  if (isProtected && !req.auth) {
    return NextResponse.redirect(new URL('/login', req.nextUrl))
  }
})

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)',
  ],
}
