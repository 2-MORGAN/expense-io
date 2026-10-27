import { expect, it } from 'vitest'
import { ReceiptNotVisible } from '@/domain/expense/ReceiptAccess'
import { ExpenseNoteNotVisible } from '@/domain/validation/DecideExpenseNote'
import { respondError } from './errors'

// Reçu hors périmètre (domaine Expense) et note non visible (domaine
// Validation) : même 404 public, au mot près (RECU-05, ISO-04, ISO-05).
it.each([
  ['ReceiptNotVisible', new ReceiptNotVisible()],
  ['ExpenseNoteNotVisible', new ExpenseNoteNotVisible()],
])('%s → 404 RESOURCE_NOT_FOUND, error « Not found »', async (_name, error) => {
  const response = respondError(error)
  expect(response.status).toBe(404)
  expect(response.headers.get('Content-Type')).toBe('application/problem+json')
  expect(await response.json()).toMatchObject({ status: 404, code: 'RESOURCE_NOT_FOUND', error: 'Not found' })
})
