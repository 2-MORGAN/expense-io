import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import type { NextRequest } from 'next/server'
import bcrypt from 'bcryptjs'
import { withSystemTransaction } from '@/lib/db'
import { EmailNotVerified, TooManyLoginAttempts } from '@/lib/authErrors'
import { logError } from '@/lib/log'
import { clientIp, loginRetryAfter, recordLoginFailure, throttleKeys } from '@/lib/loginThrottle'
import { loadSessionUser } from '@/lib/sessionUser'

// Session de 8 h d'inactivité (S9, ADR-001 §4) : une journée de travail. Elle
// borne aussi la durée pendant laquelle un cookie volé reste utilisable.
// Chaque requête repousse l'échéance (jeton réémis par Auth.js).
export const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60

// Empreinte bcrypt (coût 12, comme les comptes) d'une valeur aléatoire jetée :
// un email inconnu coûte le même `bcrypt.compare` qu'un mauvais mot de passe,
// sa réponse n'est donc pas plus rapide (énumération, ADR-001 §4 point 4).
const UNKNOWN_USER_HASH = '$2b$12$D9KTlvaDciloQpY29JAo1O/cTNa.K7nNbFqpvFZ5l0MJ6JfQIZXFa'

const nextAuth = NextAuth({
  // Secret de signature des sessions : uniquement par l'environnement
  // (`.env.example`). Absent, Auth.js refuse de démarrer (MissingSecret).
  secret: process.env.AUTH_SECRET,
  session: { strategy: 'jwt', maxAge: SESSION_MAX_AGE_SECONDS },
  pages: {
    signIn: '/login',
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Mot de passe', type: 'password' },
      },
      async authorize(credentials, request) {
        const email = typeof credentials?.email === 'string' ? credentials.email : null
        const password =
          typeof credentials?.password === 'string' ? credentials.password : null
        if (!email || !password) return null

        // Limite de tentatives (AUTH-11) : seul point commun à la server
        // action `/login` et à `/api/auth/callback/credentials`, avant
        // `bcrypt.compare`. Seuls les échecs sont écrits.
        const keys = throttleKeys(email, clientIp(request?.headers))
        if (await loginRetryAfter(keys) > 0) throw new TooManyLoginAttempts()

        // Avant toute session : pas d'utilisateur à poser en contexte. La
        // fonction `auth_find_user` (SECURITY DEFINER) rend la seule ligne de
        // cet email ; le rôle de l'application n'a aucun droit sur
        // `password_hash` (ADR-001 §4, 2-481).
        const result = await withSystemTransaction((client) => client.query<{
          id: string
          email: string
          password_hash: string
          role: 'employee' | 'manager' | 'hr_admin'
          email_verified_at: Date | null
        }>('SELECT id, email, password_hash, role, email_verified_at FROM auth_find_user($1)', [
          email,
        ]))
        const user = result.rows[0]

        const passwordMatches = await bcrypt.compare(password, user?.password_hash ?? UNKNOWN_USER_HASH)
        if (!user || !passwordMatches) {
          await recordLoginFailure(keys)
          return null
        }
        // Créateur d'entreprise qui n'a pas encore confirmé son email (S7).
        if (!user.email_verified_at) throw new EmailNotVerified()

        return { id: user.id, email: user.email, role: user.role }
      },
    }),
  ],
  callbacks: {
    // S9 : le rôle n'est pas figé dans le jeton, il est relu en base à chaque
    // lecture de session. `null` (compte supprimé) fait effacer le cookie par
    // Auth.js, comme une erreur de base (échec fermé, ADR-001 §4).
    async jwt({ token, user }) {
      if (user) token.id = user.id
      if (typeof token.id !== 'string') return null
      const current = await loadSessionUser(token.id)
      if (!current) return null
      token.role = current.role
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string
        session.user.role = token.role as 'employee' | 'manager' | 'hr_admin'
      }
      return session
    },
  },
})

export const { auth, signIn, signOut } = nextAuth

const CREDENTIALS_CALLBACK = '/api/auth/callback/credentials'

/**
 * Appel direct de l'API de connexion au-delà de la limite (AUTH-11) : 429 et
 * `Retry-After` (cours 3), au lieu de la redirection d'échec d'Auth.js.
 * Le formulaire `/login` passe par la server action, qui affiche un message.
 */
async function postWithLoginThrottle(request: NextRequest): Promise<Response> {
  if (new URL(request.url).pathname === CREDENTIALS_CALLBACK) {
    try {
      const email = (await request.clone().formData()).get('email')
      const retryAfter = typeof email === 'string' && email
        ? await loginRetryAfter(throttleKeys(email, clientIp(request.headers)))
        : 0
      if (retryAfter > 0) return tooManyAttempts(retryAfter)
    } catch (error) {
      // Corps illisible ou base indisponible : Auth.js traite la requête et
      // `authorize()` refait le contrôle.
      logError('auth.throttle.check', error, { route: CREDENTIALS_CALLBACK })
    }
  }
  return nextAuth.handlers.POST(request)
}

function tooManyAttempts(retryAfter: number): Response {
  return Response.json({
    type: 'about:blank',
    title: 'Too Many Requests',
    status: 429,
    detail: 'Too many failed sign-in attempts. Retry later.',
    code: 'TOO_MANY_LOGIN_ATTEMPTS',
  }, {
    status: 429,
    headers: { 'Content-Type': 'application/problem+json', 'Retry-After': String(retryAfter), 'Cache-Control': 'no-store' },
  })
}

// Appels différés : `nextAuth.handlers` n'est lu qu'à la requête.
export const handlers = {
  GET: (request: NextRequest) => nextAuth.handlers.GET(request),
  POST: postWithLoginThrottle,
}
