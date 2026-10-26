import { auth } from '@/lib/auth'
import { withApiErrors } from '@/http/withApiErrors'
import { problemResponse } from '@/http/problem'
import { requireRole } from '@/http/requireRole'
import type { Invitation } from '@/http/dto'
import { inviteEmployee } from '@/composition/identity'
import { InvalidEmail } from '@/domain/identity/identity'

// Invitation d'un salarié par la RH (S7, ADR-001 §3) : l'email part par
// l'outbox, le lien vaut vérification de l'adresse. Erreurs au format commun
// application/problem+json (2-485).
export const POST = withApiErrors('/api/hr/invitations', async function POST(request: Request) {
  const session = await auth()
  const actor = requireRole(session, 'hr_admin')
  if (actor instanceof Response) return actor

  const body: unknown = await request.json().catch(() => null)
  const email = typeof body === 'object' && body !== null && 'email' in body ? body.email : undefined

  try {
    const invitation = await inviteEmployee.execute(actor.id, email)
    return Response.json(invitation satisfies Invitation, { status: 201 })
  } catch (error) {
    if (error instanceof InvalidEmail) return problemResponse('INVALID_EMAIL')
    throw error
  }
})
