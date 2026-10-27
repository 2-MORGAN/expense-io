import { afterEach, expect, it, vi } from 'vitest'
import { withApiErrors } from './withApiErrors'
import { problemResponse } from './problem'
import { requestContext } from './requestContext'
import { InputError } from './validation'
import { respondError } from './errors'

afterEach(() => vi.restoreAllMocks())

it.each([
  () => { throw new Error('private synchronous failure') },
  async () => { await Promise.resolve(); throw new Error('private asynchronous failure') },
  () => Response.json({ value: BigInt(1) }),
])('captures synchronous, asynchronous and serialization failures', async operation => {
  const logger = vi.spyOn(console, 'error').mockImplementation(() => {})
  const handler = withApiErrors('/api/example/[id]', (request: Request) => { expect(request.method).toBe('POST'); return operation() })
  const response = await handler(new Request('http://localhost/api/example/123?secret=private', { method: 'POST' }))
  const body = await response.json()
  expect(body).toMatchObject({ status: 500, code: 'INTERNAL_ERROR' })
  expect(JSON.stringify(body)).not.toContain('private')
  expect(logger).toHaveBeenCalledTimes(1)
  const entry = JSON.parse(String(logger.mock.calls[0][0]))
  expect(entry).toMatchObject({ method: 'POST', route: '/api/example/[id]', requestId: body.requestId })
  expect(entry).not.toHaveProperty('url')
})

it('keeps a distinct server-generated id in concurrent requests, for refusals and exceptions', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const ids: string[] = []
  let release!: () => void
  const barrier = new Promise<void>(resolve => { release = resolve })
  const handler = withApiErrors('/api/example', async (request: Request) => {
    ids.push(requestContext.getStore()!.requestId)
    if (ids.length === 2) release()
    await barrier
    if (request.method === 'POST') throw new InputError('INVALID_JSON')
    return problemResponse('FORBIDDEN')
  })
  const responses = await Promise.all(['GET', 'POST'].map(method => handler(new Request('http://localhost', {
    method, headers: { 'X-Request-Id': 'untrusted-client-value' },
  }))))
  const bodies = await Promise.all(responses.map(response => response.json()))
  expect(new Set(ids).size).toBe(2)
  for (const [index, body] of bodies.entries()) {
    expect(body.requestId).toBe(ids[index])
    expect(responses[index].headers.get('X-Request-Id')).toBe(ids[index])
    expect(body.requestId).not.toBe('untrusted-client-value')
  }
  expect(requestContext.getStore()).toBeUndefined()
})

it.each([new Error('Already decided'), { code: 'FORBIDDEN', status: 403, message: 'private' }, Object.create(null)])('never guesses an expected refusal from an untrusted thrown value', async error => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const response = respondError(error)
  expect(response.status).toBe(500)
  expect(await response.json()).toMatchObject({ code: 'INTERNAL_ERROR', error: 'An unexpected error occurred.' })
})
