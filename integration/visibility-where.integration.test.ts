import { beforeAll, describe, expect, it } from 'vitest'
import { configureDatabase, currentDatabaseRole } from '@/lib/db'
import { OWNER_DATABASE_URL } from './support/env'
import { visibilityMatrix } from './support/visibility'

// Même matrice que visibility.integration.test.ts, mais RLS contournée : les
// adaptateurs se connectent sous le propriétaire de docker-compose.yml
// (superutilisateur). Le domaine est alors confronté aux seules requêtes des
// listes ; sous la RLS, une erreur répétée par une policy (liste RH sans
// « manager racine », par exemple) passerait inaperçue.
configureDatabase(OWNER_DATABASE_URL, 'expense-integration-sans-rls')

describe('domaine ⟺ requêtes des listes, RLS contournée', () => {
  beforeAll(async () => {
    const role = await currentDatabaseRole()
    expect(role.superuser || role.bypassRls, 'le propriétaire doit contourner la RLS, sinon la matrice ne teste pas les requêtes seules').toBe(true)
  })

  const matrix = visibilityMatrix()
  it.each(matrix.cases)('%s lit la note de %s', matrix.check)
})
