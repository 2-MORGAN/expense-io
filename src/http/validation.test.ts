import { describe, expect, it } from 'vitest'
import { validateInput, InputError, inputProblem } from './validation'

const valid = { amount: '12.50', expenseDate: '2024-02-29', description: 'Repas', receipt: '' }
describe('contract-derived input validation', () => {
  it.each(['12abc', '12,50', '1e2', '0.001', '0', '-1', '100000000', ' 12', '12.'])('rejects amount %s', (amount) => {
    expect(() => validateInput('CreateExpenseNote', { ...valid, amount })).toThrow(InputError)
  })
  it.each(['12', '12.5', '12.50', '99999999.99'])('accepts amount %s', (amount) => {
    expect(validateInput('CreateExpenseNote', { ...valid, amount }).amount).toBe(amount)
  })
  it.each(['0000-01-01', '2023-02-29', '2024-04-31', '2024-13-01', '2024-2-01', '2024-01-01T00:00:00Z'])('rejects date %s', (expenseDate) => {
    expect(() => validateInput('CreateExpenseNote', { ...valid, expenseDate })).toThrow(InputError)
  })
  it.each([{}, null, [], { managerId: 0 }, { managerId: '' }, { managerId: 'not-a-uuid' }])('does not turn %j into a detachment', (input) => {
    expect(() => validateInput('SetManager', input)).toThrow(InputError)
  })
  it('preserves explicit null and does not modify input', () => {
    const input = { managerId: null }
    expect(validateInput('SetManager', input)).toEqual(input)
    expect(input).toEqual({ managerId: null })
  })
  it('does not expose a submitted value in field errors', async () => {
    try { validateInput('CreateExpenseNote', { ...valid, amount: 'secret-value' }) }
    catch (error) {
      const response = inputProblem(error as InputError)
      expect(response.status).toBe(400)
      expect(response.headers.get('Content-Type')).toContain('application/problem+json')
      const body = await response.json()
      expect(body).toMatchObject({ status: 400, code: 'VALIDATION_ERROR', errors: [{ field: 'amount', code: 'INVALID_AMOUNT' }] })
      expect(JSON.stringify(body)).not.toContain('secret-value')
      return
    }
    throw new Error('Expected rejection')
  })
})
