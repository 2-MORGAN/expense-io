import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ResendVerificationForm } from './ResendVerificationForm'
import { resendVerification } from '@/app/actions/auth'

// Renvoi de l'email de vérification (S7) avec sa server action simulée : le
// message affiché ne dépend que de ce que rend l'action (même message pour
// une adresse inconnue, SIGNUP-13).
vi.mock('@/app/actions/auth', () => ({ resendVerification: vi.fn(async () => ({})) }))

async function resend(email: string) {
  await userEvent.type(screen.getByLabelText('Email'), email)
  await userEvent.click(screen.getByRole('button', { name: "Renvoyer l'email" }))
}

describe('ResendVerificationForm', () => {
  it('envoie l’adresse saisie et affiche la confirmation rendue par l’action', async () => {
    vi.mocked(resendVerification).mockResolvedValueOnce({ notice: 'Si un compte attend une confirmation, un nouvel email est parti.' })
    render(<ResendVerificationForm />)
    await resend('oublieux@acme.test')
    expect((await screen.findByRole('status')).textContent).toBe('Si un compte attend une confirmation, un nouvel email est parti.')
    const data = vi.mocked(resendVerification).mock.calls[0][1] as FormData
    expect(data.get('email')).toBe('oublieux@acme.test')
  })

  it('affiche l’erreur rendue par l’action, sans confirmation', async () => {
    vi.mocked(resendVerification).mockResolvedValueOnce({ error: 'Adresse email invalide.' })
    render(<ResendVerificationForm />)
    await resend('a@b.test')
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Adresse email invalide.'))
    expect(screen.queryByRole('status')).toBeNull()
  })
})
