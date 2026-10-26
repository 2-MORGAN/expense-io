import { expect, it } from 'vitest'
import { checkApiResponse } from './contractResponses'

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
