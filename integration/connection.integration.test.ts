import { expect, it } from 'vitest'
import { currentDatabaseRole } from '@/lib/db'

// Prémisse de toute la couche : le code testé se connecte sous le rôle de
// l'application, soumis à la RLS (integration/setup.ts). Sous un
// superutilisateur, chaque test « sous la RLS » passerait sans rien prouver.
it('le code testé tourne sous expense_app, ni superutilisateur ni BYPASSRLS', async () => {
  expect(await currentDatabaseRole()).toEqual({ name: 'expense_app', superuser: false, bypassRls: false })
})
