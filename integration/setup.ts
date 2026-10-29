import { afterAll } from 'vitest'
import { APP_DATABASE_URL } from './support/env'
import { closePool, configureDatabase } from '@/lib/db'
import { closeOwner } from './support/tenant'
import { closeWorker } from './support/worker'

// Avant chaque fichier du projet `integration` (vitest.config.mts). Chaque
// fichier tourne dans son propre processus : le code de src/ s'y connecte sous
// le rôle de l'application, `expense_app`, soumis à la RLS, comme en
// production. Les fixtures passent par la connexion propriétaire
// (`support/tenant.ts`), jamais par celle-ci.
configureDatabase(APP_DATABASE_URL, 'expense-integration')

afterAll(async () => {
  await closePool()
  await closeOwner()
  await closeWorker()
})
