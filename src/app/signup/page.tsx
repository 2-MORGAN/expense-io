import { SignupForm } from '@/components/SignupForm'
import { signUp } from '@/composition/identity'

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ invitation?: string | string[] }>
}) {
  const { invitation: token } = await searchParams
  if (typeof token !== 'string' || token.length === 0) {
    return <SignupForm />
  }

  const invitation = await signUp.previewInvitation(token)
  if (!invitation) {
    return <SignupForm invitationInvalid />
  }
  return <SignupForm invitation={{ token, ...invitation }} />
}
