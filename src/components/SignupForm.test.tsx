import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SignupForm } from './SignupForm'
import { signup } from '@/app/actions/auth'

// Formulaire d'inscription (S7) avec sa server action simulée : ce que
// l'écran envoie et ce qu'il affiche du résultat. L'inscription elle-même
// (fonctions SECURITY DEFINER, email de vérification) est couverte par les
// tests d'intégration et les E2E SIGNUP-*.
vi.mock('@/app/actions/auth', () => ({ signup: vi.fn(async () => ({})) }))

async function fillAndSubmit(fields: { name: string; email?: string; password: string }) {
  await userEvent.type(screen.getByLabelText('Nom'), fields.name)
  if (fields.email) await userEvent.type(screen.getByLabelText('Email'), fields.email)
  await userEvent.type(screen.getByLabelText('Mot de passe'), fields.password)
  await userEvent.click(screen.getByRole('button', { name: "S'inscrire" }))
}

describe('SignupForm', () => {
  it('sans invitation : envoie nom, email et mot de passe à la server action', async () => {
    render(<SignupForm />)
    expect(screen.getByText('Quelques secondes suffisent.')).toBeTruthy()
    await fillAndSubmit({ name: 'Fanny Fondatrice', email: 'fanny@acme.test', password: 'mot-de-passe-1' })
    await waitFor(() => expect(signup).toHaveBeenCalledTimes(1))
    const data = vi.mocked(signup).mock.calls[0][1] as FormData
    expect([data.get('name'), data.get('email'), data.get('password'), data.get('invitation')]).toEqual([
      'Fanny Fondatrice',
      'fanny@acme.test',
      'mot-de-passe-1',
      null,
    ])
  })

  it('avec une invitation : entreprise affichée, adresse imposée en lecture seule, jeton joint', async () => {
    render(<SignupForm invitation={{ token: 'jeton-secret', email: 'recrue@acme.test', companyName: 'Acme' }} />)
    expect(screen.getByText('Acme').tagName).toBe('STRONG')
    const email = screen.getByLabelText('Email') as HTMLInputElement
    expect([email.value, email.readOnly]).toEqual(['recrue@acme.test', true])
    await fillAndSubmit({ name: 'Rita Recrue', password: 'mot-de-passe-1' })
    await waitFor(() => expect(signup).toHaveBeenCalled())
    const data = vi.mocked(signup).mock.calls.at(-1)![1] as FormData
    expect([data.get('email'), data.get('invitation')]).toEqual(['recrue@acme.test', 'jeton-secret'])
  })

  it('affiche l’erreur rendue par l’action', async () => {
    vi.mocked(signup).mockResolvedValueOnce({ error: 'Un compte existe déjà avec cet email.' })
    render(<SignupForm />)
    await fillAndSubmit({ name: 'Doublon', email: 'deja@acme.test', password: 'mot-de-passe-1' })
    expect((await screen.findByRole('alert')).textContent).toBe('Un compte existe déjà avec cet email.')
  })

  it('invitation invalide ou expirée : avertissement, le formulaire reste utilisable', () => {
    render(<SignupForm invitationInvalid />)
    expect(screen.getByRole('alert').textContent).toMatch(/^Invitation invalide ou expirée\./)
    expect((screen.getByLabelText('Email') as HTMLInputElement).readOnly).toBe(false)
  })
})
