import { describe, expect, it } from 'vitest'
import { parseAmount, parseDescription, parseExpenseDate } from './parseReceiptText'

// Textes réellement rendus par le moteur OCR (Tesseract, `fra`) : les deux reçus
// de `e2e/fixtures/` et une facture de restaurant réaliste rendue en image.
const OCR_RECU_COMPLET = 'RESTAURANT LE TEST\nDate : 11/10/2026\nTOTAL TTC : 42,50 EUR\n'
const OCR_RECU_MONTANT_SEUL = 'BOULANGERIE DU COIN\nTOTAL TTC : 12,30 EUR\n'
const OCR_FACTURE_RESTAURANT = [
  'FACTURE EXEMPLE FICTIF',
  '',
  'BISTRO CENTRAL Facture n° : 2026-1005',
  '',
  '12 rue Exemple, 75000 Paris Date : 05/10/2026',
  '',
  'SIRET : 123 456 789 00010 Table : 08',
  '',
  'TVA : FR12 123456789',
  '',
  'Article Qté Prix Total',
  '',
  'Menu du jour 1 22.00€ 22.00€',
  'TOTAL TTC 28.50 €',
].join('\n')
// La même facture, texte OCR complet (tableau d'articles et trois lignes de total).
const OCR_FACTURE_RESTAURANT_COMPLETE = [
  'FACTURE EXEMPLE FICTIF',
  '',
  'BISTRO CENTRAL Facture n° : 2026-1005',
  '',
  '12 rue Exemple, 75000 Paris Date : 05/10/2026',
  '',
  'SIRET : 123 456 789 00010 Table : 08',
  '',
  'TVA : FR12 123456789',
  '',
  'Article Qté Prix Total',
  '',
  'Menu du jour 1 22.00€ 22.00€',
  '',
  'Eau minérale 1 4.00€ 4.00€',
  '',
  'Café 1 2.50€ 2.50€',
  'Total HT 25.91 €',
  'TVA 10% 2.59€',
  'TOTAL TTC 28.50 €',
  '',
  'Paiement : Carte bancaire',
  '',
  'Merci de votre visite.',
].join('\n')

// Correctif : la première ligne « total » était retenue même sans montant
// (en-tête de tableau), puis le repli sur les entiers gardait le plus grand
// nombre du ticket, souvent des centimes (91 dans 25.91).
describe('receipt amount on a realistic ticket (several total lines)', () => {
  it('reads the TTC total of a restaurant invoice, not a number from the table header', () => {
    expect(parseAmount(OCR_FACTURE_RESTAURANT_COMPLETE)).toBe(28.5)
  })

  it.each([
    ['TTC preferred over an earlier HT total', 'Total HT 25,91 €\nTVA 10 % 2,59 €\nTotal TTC 28,50 €', 28.5],
    ['amount payable preferred over a subtotal', 'Sous-total 20,00\nNet à payer 18,00', 18],
    ['last total wins when none is TTC', 'Sous-total 20,00\nRemise 2,00\nTotal 18,00', 18],
    ['a total line without amount is skipped', 'Article Qté Prix Total\nCafé 1 2,50 2,50\nTotal 2,50', 2.5],
  ])('%s', (_case, text, expected) => {
    expect(parseAmount(text)).toBe(expected)
  })
})

describe('receipt description suggestion (merchant name)', () => {
  it.each([
    ['receipt fixture with date', OCR_RECU_COMPLET, 'Restaurant le Test'],
    ['receipt fixture without date', OCR_RECU_MONTANT_SEUL, 'Boulangerie du Coin'],
    ['realistic invoice: document title skipped, name cut before "Facture"', OCR_FACTURE_RESTAURANT, 'Bistro Central'],
    ['mixed case kept as printed', 'Café de Flore\nTotal : 8,40 €', 'Café de Flore'],
    ['"Hôtel" is not taken for a phone label', 'HÔTEL DU NORD\nTél : 01 23 45 67 89', 'Hôtel du Nord'],
    ['trailing separators removed', 'TAXI PARISIEN -\nTOTAL 35,00 EUR', 'Taxi Parisien'],
  ])('%s', (_case, text, expected) => {
    expect(parseDescription(text)).toBe(expected)
  })

  it.each([
    ['address or numbers only', '12 rue Exemple\n75000 Paris'],
    ['only amounts and legal mentions', 'TOTAL TTC : 42,50 EUR\nSIRET : 123 456 789'],
    ['too few letters', 'AB\n-- 12 --'],
    ['empty text', ''],
    ['name beyond the first lines', 'Date : 11/10/2026\n1\n2\n3\n4\n5\nRESTAURANT TARDIF'],
  ])('nothing suggested: %s', (_case, text) => {
    expect(parseDescription(text)).toBeUndefined()
  })
})

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
