import { auth } from '@/lib/auth'
import { withApiErrors } from '@/http/withApiErrors'
import { problemResponse } from '@/http/problem'
import { requireRole } from '@/http/requireRole'
import { readJsonBody, validateInput } from '@/http/validation'
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

  // Même ordre que les autres opérations JSON (ADR-004 §6) : JSON malformé →
  // INVALID_JSON, corps hors contrat → VALIDATION_ERROR, puis la syntaxe de
  // l'adresse par le domaine → INVALID_EMAIL.
  const { email } = validateInput('CreateInvitation', await readJsonBody(request))

  try {
    const invitation = await inviteEmployee.execute(actor.id, email)
    return Response.json(invitation satisfies Invitation, { status: 201 })
  } catch (error) {
    if (error instanceof InvalidEmail) return problemResponse('INVALID_EMAIL')
    throw error
  }
})
