import { NextResponse, type NextRequest } from 'next/server'
import { signUp } from '@/composition/identity'

// Lien de l'email de vérification (S7) : confirme l'adresse du créateur de
// l'entreprise, puis renvoie vers la connexion.
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')
  const verified = token ? await signUp.verifyEmail(token) : false
  const target = new URL('/login', request.nextUrl)
  target.searchParams.set(verified ? 'verified' : 'verification', verified ? '1' : 'invalid')
  return NextResponse.redirect(target, 303)
}
