import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { getPool } from '@/lib/db'
import { EmailNotVerified } from '@/lib/authErrors'

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Secret de signature des sessions : uniquement par l'environnement
  // (`.env.example`). Absent, Auth.js refuse de démarrer (MissingSecret).
  secret: process.env.AUTH_SECRET,
  session: { strategy: 'jwt' },
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

        const result = await getPool().query<{
          id: string
          email: string
          password_hash: string
          role: 'employee' | 'manager' | 'hr_admin'
          email_verified_at: Date | null
        }>('SELECT id, email, password_hash, role, email_verified_at FROM users WHERE email = $1', [
          email,
        ])
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
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.role = user.role
      }
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
