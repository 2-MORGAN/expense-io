import { afterEach, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'user', role: 'manager' } })) }))
vi.mock('@/lib/db', () => ({ withUserScope: vi.fn() }))
import { withUserScope } from '@/lib/db'
import { GET } from '@/app/api/manager/expense-notes/route'
import { respondError } from '@/lib/errors'

afterEach(() => vi.restoreAllMocks())

it('S6: an internal cause and stack stay on the server, correlated with the public problem', async () => {
  const logger = vi.spyOn(console, 'error').mockImplementation(() => {})
  const response = respondError(new Error('SQL connection failed: secret-internal-marker'))
  expect(response.status).toBe(500)
  expect(response.headers.get('content-type')).toContain('application/problem+json')
  const body = await response.json()
  expect(body).toMatchObject({ code: 'INTERNAL_ERROR', status: 500 })
  expect(body).not.toHaveProperty('stack')
  expect(JSON.stringify(body)).not.toContain('secret-internal-marker')
  expect(JSON.parse(String(logger.mock.calls[0][0]))).toMatchObject({ requestId: body.requestId })
})

it('Q1.3: a late transaction rejection is captured before returning the HTTP response', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.mocked(withUserScope).mockImplementationOnce(async () => {
    await Promise.resolve()
    throw new Error('late database failure')
  })
  await expect(GET()).resolves.toMatchObject({ status: 500 })
})
