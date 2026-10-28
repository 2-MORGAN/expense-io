# e2e — tests de non-régression (Playwright)

Consignes du dossier, en complément du [CLAUDE.md](../CLAUDE.md) de la racine, qui reste la référence. Chemins donnés depuis la racine du dépôt.

La suite fige le comportement observable : parcours UI, codes HTTP, JSON, droits, isolation entre entreprises, policies en base. Les correcteurs la rejouent. Registre des scénarios et de leurs IDs : `docs/tests/E2E.md`.

## Règle d'or

Un test existant ne se modifie pas, ne se désactive pas, ne se supprime pas pour faire passer la CI (ADR-005 §2). Rouge = régression : corriger le code. Si le comportement doit vraiment changer, s'arrêter et demander : il faut une ADR acceptée.

## Ajouter un scénario

1. Le mettre dans le fichier du domaine (`e2e/manager-approval.spec.ts`, `e2e/expense-notes.spec.ts`…), ou créer un `<domaine>.spec.ts`.
2. Un ID nouveau : le préfixe du domaine et le numéro suivant libre dans `docs/tests/E2E.md` (`MGR-11`), en tête du titre : `test('[MGR-11] …', async ({ org, apiAs, pageAs }) => { … })`.
3. Données : la fixture `org` crée une entreprise isolée (RH, manager racine, employé) ; `apiAs(user)` donne un client HTTP connecté, `pageAs(user)` une page connectée (`e2e/support/fixtures.ts`). Les notes se créent et se tranchent par l'API, jamais en SQL.
4. Assertions : `toMatchObject` pour tolérer les champs ajoutés ; `toMatchObject({ code: 'VALIDATION_ERROR' })` pour une erreur ; les formes communes de `e2e/support/api.ts`. Chaque réponse est déjà contrôlée contre le contrat.
5. UI : sélecteurs par rôle et libellé (`getByRole`, `getByLabel`), pas par classe CSS.
6. La ligne dans le tableau de `docs/tests/E2E.md` (ID, scénario, niveau), et le total mis à jour.
7. Lancer : `npx playwright test -g "MGR-11"` (réutilise le serveur de `make dev`), puis tout le fichier.

## Exemples à copier

- `e2e/manager-approval.spec.ts` : API et interface.
- `e2e/invitations.spec.ts` : emails lus dans Mailpit (`e2e/support/mailpit.ts`, `waitForEmail`).
- `e2e/rls-isolation.spec.ts` : policies vérifiées en base.
- `e2e/outbox-worker.spec.ts` : outbox et worker (`e2e/support/outbox.ts`).

## Pièges

- Chaque test crée ses données (domaine unique `*.e2e.test`) : pas de dépendance à l'ordre, au seed ni à un autre test.
- Pas de `test.only`, `.skip`, `.fixme` ni `.fail` (ESLint).
- Pas d'attente fixe (`waitForTimeout`) : attendre un état (`expect(…).toBeVisible()`, `waitForEmail`).
- Ne pas modifier `src/` pendant un run local : le serveur de dev recompile et des tests échouent au hasard.

## Vérifié par

- ESLint (`expense-io/tests`) ; la CI lance toute la suite sur chaque PR (`e2e`, 2 shards).
