import { describe, expect, it } from 'vitest'
import { parseAmount, parseExpenseDate } from './parseReceiptText'

// Caractérisation du parseur d'origine, avant déplacement derrière le cas d'usage.
describe('receipt field extraction — existing behaviour', () => {
  it.each([
    ['TOTAL TTC : 42,50 EUR', 42.5],
    ['Montant : 1 234,56 €', 1234.56],
    ['Total : 1.234,56 EUR', 1234.56],
    ['NET À PAYER : 12 EUR', 12],
    ['TTC : 15.20', 15.2],
    ['Article 10,00\nTOTAL TTC : 42,50 EUR', 42.5],
    ['Prix 12,30\nAutre 19,50', 19.5],
    ['Reçu sans montant', undefined],
  ])('amount in %s', (text, expected) => {
    expect(parseAmount(text)).toBe(expected)
  })

  it.each([
    ['Date : 11/10/2026', '2026-10-11'],
    ['Date : 2026-10-11', '2026-10-11'],
    ['Date : 11.10.2026', '2026-10-11'],
    ['Date : 11-10-26', '2026-10-11'],
    ['Date : 29 février 2024', '2024-02-29'],
    ['Date : 15 août 2026', '2026-08-15'],
    ['Date : 31/04/2026', undefined],
    ['Reçu sans date', undefined],
  ])('date in %s', (text, expected) => {
    expect(parseExpenseDate(text)).toBe(expected)
  })
})
