# integration — couche d'intégration (Vitest, ADR-009)

Consignes du dossier, en complément du [CLAUDE.md](../CLAUDE.md) de la racine, qui reste la référence. Chemins donnés depuis la racine du dépôt.

La couche qui donne le plus de confiance pour son coût (testing trophy) : plusieurs unités réelles ensemble, contre le vrai PostgreSQL sous la RLS, le S3 et le SMTP de `docker-compose.yml`, sans serveur ni navigateur. Ici : le support commun (`integration/support`) et les tests qui traversent plusieurs couches. Le test d'un seul adaptateur, cas d'usage ou handler du worker vit à côté de son code (`src/**/*.integration.test.ts`) ; celui d'un composant React aussi (`*.test.tsx`, projet `components`, sans Docker).

## Où mettre un test

| Ce qu'on vérifie | Où | Lancé par |
|---|---|---|
| Règle pure, sans entrée-sortie | `*.test.ts` à côté du code | `npm run check` |
| Composant ou page client : rendu, interactions, erreurs traduites | `*.test.tsx` à côté, réseau simulé par `integration/support/fetch.ts` | `npm run check` |
| Requête SQL, policy RLS, adaptateur S3 ou SMTP, cas d'usage avec ses adaptateurs, handler du worker | `src/**/*.integration.test.ts` à côté du code | `npm run test:integration` |
| Route appelée dans le processus, matrice qui confronte plusieurs couches | `integration/*.integration.test.ts` | `npm run test:integration` |
| Parcours utilisateur, contrat HTTP de bout en bout | `e2e/*.spec.ts`, avec un ID (`e2e/AGENTS.md`) | `make test-e2e` |

## Écrire un test d'intégration

1. Une entreprise par test : `createTenant()` de `integration/support/tenant.ts` (RH, manager racine, employé), `addMember()` pour le reste. Jamais de dépendance à l'ordre ni à une autre donnée.
2. Le code testé se connecte sous `expense_app` (`integration/setup.ts`) : la RLS s'applique. Préparer et vérifier en base passe par `owner()`, jamais par le code testé. Un fichier qui teste le worker appelle `connectAsWorker()` en tête (`integration/support/worker.ts`).
3. Les notes se créent par le vrai adaptateur : `submitNote()` et `decide()` de `integration/support/notes.ts`.
4. Une route s'appelle par son handler : `vi.mock('@/lib/auth', () => import('./support/auth'))`, `signInAs(member)`, puis `call()` de `integration/support/api.ts`, qui contrôle chaque réponse contre `openapi.yaml`.
5. Un événement d'outbox réel peut être consommé par un worker lancé sur la même base (`make dev`) : ne jamais attendre qu'il reste « pending ». Pour tester un handler, un type unique (`test.integration.…`) branché sur le vrai handler (`src/worker/identityEmails.integration.test.ts`).
6. Lancer : `make test-integration`, ou `make up migrate ensure-bucket` puis `npm run test:integration` ; un fichier : `npx vitest run --config vitest.integration.config.mts <fichier>`.

## Exemples à copier

- `src/adapters/PostgresExpenseNoteDecisionRepository.integration.test.ts` : un adaptateur sous la RLS, concurrence comprise.
- `src/application/SubmitExpenseNote.integration.test.ts` : un cas d'usage avec ses vrais adaptateurs, compensation S3 comprise.
- `integration/api-expense-notes.integration.test.ts` : des routes appelées dans le processus.
- `integration/visibility.integration.test.ts` et `integration/visibility-where.integration.test.ts` : la matrice « qui voit quoi », sous la RLS et sans.
- `src/components/PendingApprovalsPanel.test.tsx` : un composant, réseau simulé.

## Pièges

- Docker requis, comme pour les E2E. Sous Windows, si le port 5433 est pris, exposer PostgreSQL sur un autre port et pointer les `*DATABASE_URL` de `.env` dessus.
- La matrice sans RLS se connecte sous le propriétaire : il doit contourner la RLS, ce que `docker-compose.yml` donne ; elle le vérifie en tête.
- Pas de `.only` ni de `.skip` (ESLint, `expense-io/tests`).
- `e2e/support` et `integration/support` décrivent tous deux `users` et `companies` : une migration qui les change touche les deux.

## Vérifié par

- Job `integration` de la CI, dont le job obligatoire `e2e` attend le résultat (`.github/workflows/ci.yml`).
- `integration/connection.integration.test.ts` : le code testé ne tourne ni en superutilisateur ni en `BYPASSRLS`.
- ESLint (`expense-io/tests`) et `eslint.config.test.ts`.
