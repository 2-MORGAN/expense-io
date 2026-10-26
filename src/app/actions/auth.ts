'use server'

import { AuthError, CredentialsSignin } from 'next-auth'
import { redirect } from 'next/navigation'
import { signIn, signOut } from '@/lib/auth'
import { EMAIL_NOT_VERIFIED } from '@/lib/authErrors'
import { MIN_PASSWORD_LENGTH } from '@/application/SignUp'
import { signUp } from '@/composition/identity'

export interface AuthFormState {
  error?: string
  /** Connexion refusée faute d'email confirmé : la page propose le renvoi. */
  unverified?: boolean
  /** Message neutre, sans erreur (renvoi de l'email de vérification). */
  notice?: string
}

const SIGNUP_ERRORS = {
  invalid: `Nom requis, email invalide, ou mot de passe trop court (${MIN_PASSWORD_LENGTH} caractères minimum).`,
  email_taken: 'Un compte existe déjà avec cet email.',
  invitation_invalid: 'Invitation invalide ou expirée.',
} as const

// Inscription (S7, ADR-001 §3) : sans invitation, nouvelle entreprise dont on
// devient RH après avoir confirmé son email ; avec une invitation, on rejoint
// l'entreprise de la RH et on est connecté tout de suite.
export async function signup(
  _prevState: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const result = await signUp.execute({
    name: formData.get('name'),
    email: formData.get('email'),
    password: formData.get('password'),
    invitation: formData.get('invitation'),
  })

  if (result.kind === 'verification_sent') {
    redirect('/signup/verify')
  }
  if (result.kind !== 'joined') {
    return { error: SIGNUP_ERRORS[result.kind] }
  }

  try {
    await signIn('credentials', { email: result.email, password: result.password, redirectTo: '/expenses' })
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: 'Le compte a été créé mais la connexion automatique a échoué.' }
    }
    throw error
  }
  return {}
}

export async function login(
  _prevState: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const email = formData.get('email')
  const password = formData.get('password')

  if (typeof email !== 'string' || typeof password !== 'string') {
    return { error: 'Champs invalides.' }
  }

  try {
    await signIn('credentials', { email, password, redirectTo: '/expenses' })
  } catch (error) {
    if (error instanceof CredentialsSignin && error.code === EMAIL_NOT_VERIFIED) {
      return { error: 'Confirmez votre adresse email avant de vous connecter.', unverified: true }
    }
    if (error instanceof AuthError) {
      return { error: 'Email ou mot de passe incorrect.' }
    }
    throw error
  }
  return {}
}

// Renvoi de l'email de vérification (S7) : même réponse que l'adresse ait un
// compte non confirmé ou non, pour ne révéler aucune adresse.
export async function resendVerification(
  _prevState: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const result = await signUp.resendVerification(formData.get('email'))
  if (result === 'invalid') {
    return { error: 'Adresse email invalide.' }
  }
  return {
    notice: 'Si un compte non confirmé existe pour cette adresse, un nouvel email de confirmation a été envoyé.',
  }
}

export async function logout(): Promise<void> {
  await signOut({ redirectTo: '/login' })
}
