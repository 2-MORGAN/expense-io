import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { pdfReceipt, pngReceipt, receiptForType } from '../../e2e/support/files'
import { inspectReceipt } from '@/adapters/inspectReceipt'

vi.mock('@/lib/auth', () => ({ auth: vi.fn(async () => ({ user: { id: '00000000-0000-4000-8000-000000000001', role: 'hr_admin' } })) }))
const effects = vi.hoisted(() => ({ pool: vi.fn(() => ({ query: vi.fn() })) }))
vi.mock('@/lib/db', () => ({ withUserScope: vi.fn(async () => { throw new Error('Database must not be reached') }), getPool: effects.pool }))
vi.mock('@/lib/storage', () => ({ receiptKeyFor: vi.fn(), uploadReceipt: vi.fn() }))
import { withUserScope } from '@/lib/db'
import { uploadReceipt } from '@/lib/storage'
import { POST } from '@/app/api/expense-notes/route'
import { PUT } from '@/app/api/hr/users/[id]/manager/route'

beforeEach(() => { vi.clearAllMocks() })

function expense(fields: Record<string, string> = {}, data = pngReceipt('input')) {
  const form = new FormData()
  for (const [key, value] of Object.entries({ amount: '12.50', expenseDate: '2024-02-29', description: 'Repas', ...fields })) form.set(key, value)
  form.set('receipt', new File([new Uint8Array(data.buffer)], data.name, { type: data.mimeType }))
  return new NextRequest('http://localhost/api/expense-notes', { method: 'POST', body: form })
}

it.each<Record<string, string>>([{ amount: '12abc' }, { amount: '0.001' }, { amount: '100000000' }, { expenseDate: '2023-02-29' }])('rejects %j before DB or S3', async (input) => {
  const response = await POST(expense(input))
  expect(response.status).toBe(400)
  expect(withUserScope).not.toHaveBeenCalled()
  expect(effects.pool).not.toHaveBeenCalled()
  expect(uploadReceipt).not.toHaveBeenCalled()
})

it.each(['{}', 'null', '[]', '{bad json', '{"managerId":"bad"}'])('does not detach on %s', async (body) => {
  const response = await PUT(new Request('http://localhost', { method: 'PUT', body }), { params: Promise.resolve({ id: '00000000-0000-4000-8000-000000000001' }) })
  expect(response.status).toBe(400)
  expect(effects.pool).not.toHaveBeenCalled()
})

it.each(['image/png', 'image/jpeg', 'image/webp', 'application/pdf'])('accepts a real %s', async (type) => {
  const receipt = receiptForType('real', type)
  await expect(inspectReceipt({ data: receipt.buffer, mimeType: type })).resolves.toBeUndefined()
})

it('rejects a renamed PNG, a truncated image and a fake PDF before writes', async () => {
  const valid = pngReceipt('forged')
  const files = [
    { ...valid, mimeType: 'image/jpeg' },
    { ...valid, buffer: valid.buffer.subarray(0, 30) },
    { ...pdfReceipt('forged'), buffer: Buffer.from('%PDF-1.4\nnot a document\n%%EOF\n') },
    { ...valid, buffer: Buffer.alloc(0) },
  ]
  for (const file of files) expect((await POST(expense({}, file))).status).toBe(400)
  expect(withUserScope).not.toHaveBeenCalled()
  expect(uploadReceipt).not.toHaveBeenCalled()
})
