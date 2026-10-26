import { auth } from '@/lib/auth'
import { respondError } from '@/lib/errors'
import { requireRole } from '@/http/requireRole'
import { inviteEmployee } from '@/composition/identity'
import { InvalidEmail } from '@/domain/identity/identity'

// Invitation d'un salarié par la RH (S7, ADR-001 §3) : l'email part par
// l'outbox, le lien vaut vérification de l'adresse.
export async function POST(request: Request) {
  try {
    const session = await auth()
    const actor = requireRole(session, 'hr_admin')
    if (actor instanceof Response) return actor

    const body: unknown = await request.json().catch(() => null)
    const email = typeof body === 'object' && body !== null && 'email' in body ? body.email : undefined

    const invitation = await inviteEmployee.execute(actor.id, email)
    return Response.json(invitation, { status: 201 })
  } catch (error) {
    if (error instanceof InvalidEmail) {
      return Response.json({ error: 'Invalid email', code: 'INVALID_EMAIL' }, { status: 400 })
    }
    return respondError(error)
  }
}
