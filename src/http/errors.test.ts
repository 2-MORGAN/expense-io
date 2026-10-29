import { expect, it } from 'vitest'
import { ReceiptNotVisible } from '@/modules/expenses/domain/ReceiptAccess'
import { ExpenseNoteNotVisible } from '@/modules/validation/domain/DecideExpenseNote'
import { respondError } from './errors'

// Reçu hors périmètre et note non visible (domaine Expense) : même 404 public, au mot près (RECU-05, ISO-04, ISO-05).
it.each([
  ['ReceiptNotVisible', new ReceiptNotVisible()],
  ['ExpenseNoteNotVisible', new ExpenseNoteNotVisible()],
])('%s → 404 RESOURCE_NOT_FOUND, error « Not found »', async (_name, error) => {
  const response = respondError(error)
  expect(response.status).toBe(404)
  expect(response.headers.get('Content-Type')).toBe('application/problem+json')
  expect(await response.json()).toMatchObject({ status: 404, code: 'RESOURCE_NOT_FOUND', error: 'Not found' })
})
