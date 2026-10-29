import { describe, it } from 'vitest'
import { visibilityMatrix } from './support/visibility'

// Matrice « qui voit quoi » (integration/support/visibility.ts) telle que
// l'application la vit : connexion `expense_app`, RLS active. Une erreur d'une
// requête que la policy RLS répète reste ici invisible : la même matrice
// tourne sans RLS dans visibility-where.integration.test.ts.
describe('domaine ⟺ listes, sous la RLS (expense_app)', () => {
  const matrix = visibilityMatrix()
  it.each(matrix.cases)('%s lit la note de %s', matrix.check)
})
