import type { DefaultSession } from 'next-auth'

type UserRole = 'employee' | 'manager' | 'hr_admin'

declare module 'next-auth' {
  interface User {
    role: UserRole
  }

  interface Session {
    user: {
      id: string
      role: UserRole
    } & DefaultSession['user']
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id?: string
    role?: UserRole
  }
}
