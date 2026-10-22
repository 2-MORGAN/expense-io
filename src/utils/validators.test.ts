import { describe, expect, expectTypeOf, it } from 'vitest'
import { isNonEmptyString, isPositiveAmount, isValidEmail } from '@/utils/validators'

// Exemple de test unitaire (ADR-005 §1) : une fonction pure, testée sans base,
// S3 ni serveur, dans un fichier `*.test.ts` placé à côté d'elle. Lancer
// `npm run test:unit` (une passe, comme `npm run check` et la CI) ou
// `npx vitest` (relance les tests à chaque modification).

describe('isValidEmail', () => {
  it.each(['demo@expense.io', 'jean.dupont@exemple.fr', 'a+b@sous.domaine.com'])(
    'accepte %s',
    (email) => {
      expect(isValidEmail(email)).toBe(true)
    }
  )

  it.each([
    ['vide', ''],
    ['sans @', 'demo'],
    ['sans point dans le domaine', 'demo@expense'],
    ['sans partie locale', '@expense.io'],
    ['avec une espace', 'de mo@expense.io'],
    ['entourée d’espaces', ' demo@expense.io '],
    ['avec deux @', 'demo@@expense.io'],
  ])('refuse une adresse %s (%j)', (_case, email) => {
    expect(isValidEmail(email)).toBe(false)
  })
})

describe('isPositiveAmount', () => {
  it.each([0.01, 1, 12.5, 1_000_000])('accepte %s', (amount) => {
    expect(isPositiveAmount(amount)).toBe(true)
  })

  it.each([0, -12.5, Number.NaN, Number.POSITIVE_INFINITY])('refuse %s', (amount) => {
    expect(isPositiveAmount(amount)).toBe(false)
  })
})

describe('isNonEmptyString', () => {
  it.each(['Taxi', '  Taxi  '])('accepte %j', (value) => {
    expect(isNonEmptyString(value)).toBe(true)
  })

  it.each(['', '   ', '\n\t', null, undefined, 42, { description: 'Taxi' }])(
    'refuse %j',
    (value) => {
      expect(isNonEmptyString(value)).toBe(false)
    }
  )

  it('restreint le type à string', () => {
    // Vérifié par `npm run typecheck`, pas à l'exécution.
    expectTypeOf(isNonEmptyString).guards.toEqualTypeOf<string>()
  })
})
