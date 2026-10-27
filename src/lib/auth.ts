import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { withSystemTransaction } from '@/lib/db'
import { EmailNotVerified } from '@/lib/authErrors'
import { loadSessionUser } from '@/lib/sessionUser'

// Session de 8 h d'inactivité (S9, ADR-001 §4) : une journée de travail. Elle
// borne aussi la durée pendant laquelle un cookie volé reste utilisable.
// Chaque requête repousse l'échéance (jeton réémis par Auth.js).
export const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60

export const { handlers, auth, signIn, signOut } = NextAuth({
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
      async authorize(credentials) {
        const email = typeof credentials?.email === 'string' ? credentials.email : null
        const password =
          typeof credentials?.password === 'string' ? credentials.password : null
        if (!email || !password) return null

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
        if (!user) return null

        const passwordMatches = await bcrypt.compare(password, user.password_hash)
        if (!passwordMatches) return null
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
