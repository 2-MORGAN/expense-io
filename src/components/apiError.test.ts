import { expect, it } from 'vitest'
import contract from '@/generated/api-contract.json'
import { apiErrorMessage, responseErrorMessage } from './apiError'

it('translates all published codes without displaying API text', () => {
  for (const code of contract.components.schemas.Problem.properties.code.enum) {
    expect(apiErrorMessage({ code, error: 'INTERNAL_MARKER', detail: 'ENGLISH_MARKER' })).not.toMatch(/MARKER/)
  }
  expect(apiErrorMessage({ code: 'ALREADY_DECIDED', error: 'Already decided' })).toBe('Cette note a déjà été tranchée.')
  expect(apiErrorMessage({ code: 'VALIDATION_ERROR', errors: [{ code: 'INVALID_DATE', message: 'SECRET' }] })).toBe('La date est invalide.')
})

it.each([null, [], 42, 'bad', {}, { code: 'FUTURE_CODE' }, { code: 'constructor' }, { code: '__proto__' }, { error: 'private detail' }])('uses a French fallback for %j', body => {
  expect(apiErrorMessage(body)).toBe('Une erreur est survenue. Réessaie plus tard.')
})

it('handles a non-JSON response without exposing its body', async () => {
  expect(await responseErrorMessage(new Response('internal proxy details', { status: 500 }))).toBe('Une erreur est survenue. Réessaie plus tard.')
})
