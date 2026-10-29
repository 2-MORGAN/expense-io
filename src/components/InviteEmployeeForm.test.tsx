import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { InviteEmployeeForm } from './InviteEmployeeForm'
import { json, problem, stubFetch } from '../../integration/support/fetch'

// Invitation d'un salarié par la RH (S7) : formulaire réel, réseau simulé.

const INVITATIONS = '/api/hr/invitations'

async function invite(email: string) {
  await userEvent.type(screen.getByLabelText('Email du salarié'), email)
  await userEvent.click(screen.getByRole('button', { name: "Envoyer l'invitation" }))
}

describe('InviteEmployeeForm', () => {
  it('envoie l’adresse en JSON, confirme avec l’adresse normalisée rendue par l’API et vide le champ', async () => {
    const calls = stubFetch([
      { method: 'POST', path: INVITATIONS, reply: () => json({ id: 'x', email: 'nouveau@acme.test', expiresAt: '2026-11-05T00:00:00.000Z' }, 201) },
    ])
    render(<InviteEmployeeForm />)
    await invite('Nouveau@ACME.test')
    expect((await screen.findByRole('status')).textContent).toBe('Invitation envoyée à nouveau@acme.test.')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ email: 'Nouveau@ACME.test' })
    expect((screen.getByLabelText('Email du salarié') as HTMLInputElement).value).toBe('')
  })

  it('400 : « Adresse email invalide. » ; autre échec : message d’envoi impossible', async () => {
    const routes = [{ method: 'POST', path: INVITATIONS, reply: () => problem('INVALID_EMAIL', 400) }]
    stubFetch(routes)
    render(<InviteEmployeeForm />)
    await invite('a@b.test')
    expect((await screen.findByRole('alert')).textContent).toBe('Adresse email invalide.')

    routes.push({ method: 'POST', path: INVITATIONS, reply: () => problem('INTERNAL_ERROR', 500) })
    await userEvent.click(screen.getByRole('button', { name: "Envoyer l'invitation" }))
    expect((await screen.findByRole('alert')).textContent).toBe("L'invitation n'a pas pu être envoyée.")
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('le bouton affiche « Envoi… » et se désactive le temps de l’envoi', async () => {
    let release!: () => void
    stubFetch([
      {
        method: 'POST',
        path: INVITATIONS,
        reply: () => new Promise((resolve) => { release = () => resolve(json({ id: 'x', email: 'a@b.test', expiresAt: '2026-11-05T00:00:00.000Z' }, 201)) }),
      },
    ])
    render(<InviteEmployeeForm />)
    await invite('a@b.test')
    const button = screen.getByRole('button', { name: 'Envoi…' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    release()
    expect(await screen.findByRole('button', { name: "Envoyer l'invitation" })).toBeTruthy()
  })
})
