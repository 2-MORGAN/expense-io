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
