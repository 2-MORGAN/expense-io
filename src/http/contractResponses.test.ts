import { expect, it } from 'vitest'
import { checkApiResponse } from './contractResponses'
import { problemBody, problemCatalogue, type ProblemCode } from './problem'
import { schemaValidator } from './validation'

const url = 'http://localhost/api/receipt-analyses'
const id = '00000000-0000-4000-8000-000000000001'
const headers = { 'content-type': 'application/json', location: `/api/receipt-analyses/${id}`, 'cache-control': 'no-store' }
it('checks the actual response status, content type, body and mandatory headers', () => {
  expect(() => checkApiResponse('POST', url, 202, headers, { id, status: 'queued' })).not.toThrow()
  expect(() => checkApiResponse('POST', url, 200, headers, {})).toThrow('Undocumented status')
  expect(() => checkApiResponse('POST', url, 202, { ...headers, location: undefined } as unknown as Record<string,string>, { id, status: 'queued' })).toThrow('Missing response header')
  expect(() => checkApiResponse('POST', url, 202, headers, { id: 'bad', status: 'queued' })).toThrow('Contract mismatch')
})
it('does not mistake a failed analysis for an unsuccessful HTTP lookup', () => {
  expect(() => checkApiResponse('GET', `${url}/${id}`, 200, headers, { id, status: 'failed' })).toThrow('Contract mismatch')
})

it('requires a problem with matching status and correlation, and rejects extra internal fields', () => {
  const body = {
    type: '/problems/internal-error', title: 'Internal server error', status: 500,
    detail: 'An unexpected error occurred.', code: 'INTERNAL_ERROR', requestId: id,
    error: 'An unexpected error occurred.',
  }
  const problemHeaders = { 'content-type': 'application/problem+json', 'x-request-id': id }
  expect(() => checkApiResponse('POST', url, 500, problemHeaders, body)).not.toThrow()
  expect(() => checkApiResponse('POST', url, 500, problemHeaders, { ...body, stack: 'private' })).toThrow('Contract mismatch')
  expect(() => checkApiResponse('POST', url, 500, { ...problemHeaders, 'x-request-id': '00000000-0000-4000-8000-000000000002' }, body)).toThrow('Problem requestId differs')
  expect(() => checkApiResponse('POST', url, 500, problemHeaders, { ...body, status: 400 })).toThrow('Problem status differs')
})

// Point 5 de la revue de l'API (27/10) : un code d'erreur n'est valide qu'avec
// son statut HTTP. Le schéma Problem du contrat porte cette correspondance.
it('rejects a problem code paired with another HTTP status', () => {
  const invitations = 'http://localhost/api/hr/invitations'
  const problemHeaders = { 'content-type': 'application/problem+json', 'x-request-id': id }
  const problem = (code: ProblemCode, status: number) => ({ ...problemBody(code, { requestId: id }), status })
  expect(() => checkApiResponse('POST', invitations, 400, problemHeaders, problem('INVALID_EMAIL', 400))).not.toThrow()
  expect(() => checkApiResponse('POST', invitations, 400, problemHeaders, problem('FORBIDDEN', 400))).toThrow('Contract mismatch')
  expect(() => checkApiResponse('POST', invitations, 403, problemHeaders, problem('INVALID_EMAIL', 403))).toThrow('Contract mismatch')
  expect(() => checkApiResponse('POST', invitations, 500, problemHeaders, problem('AUTHENTICATION_REQUIRED', 500))).toThrow('Contract mismatch')
})

it.each(Object.keys(problemCatalogue) as ProblemCode[])('the catalogue status of %s satisfies the contract', (code) => {
  expect(schemaValidator('Problem')(problemBody(code, { requestId: id }))).toBe(true)
})
