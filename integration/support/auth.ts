import type { Session } from 'next-auth'
import type { Member } from './tenant'

// Remplace `src/lib/auth.ts` dans les tests de routes, et lui seul :
//   vi.mock('@/lib/auth', () => import('./support/auth'))
// La route lit la session du test ; tout le reste (garde, validation, cas
// d'usage, adaptateurs, PostgreSQL sous la RLS, S3) est le vrai code. La
// connexion elle-même (Auth.js, cookie, rôle relu à chaque requête) reste
// couverte par les E2E (AUTH-*).

let current: Session | null = null

export async function auth(): Promise<Session | null> {
  return current
}

/** Session de `member` pour les appels suivants ; `null` : anonyme. */
export function signInAs(member: Member | null): void {
  current = member && {
    user: { id: member.id, role: member.role, email: member.email, name: member.name },
    expires: new Date(Date.now() + 3600_000).toISOString(),
  }
}
