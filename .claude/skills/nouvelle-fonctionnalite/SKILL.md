---
name: nouvelle-fonctionnalite
description: Ajouter ou modifier une fonctionnalité d'Expense.io (nouvelle opération d'API, règle métier, champ, écran, traitement asynchrone) en suivant l'architecture du dépôt, sans parcourir toute la codebase. À utiliser pour toute demande de fonctionnalité, en particulier en live coding.
---

# Ajouter une fonctionnalité à Expense.io

Objectif : livrer une fonctionnalité qui marche, qui respecte l'architecture (ADR-002, ADR-006) et qui ne casse aucun test E2E existant, en lisant **le moins de fichiers possible**. Suivre les étapes dans l'ordre. Annoncer chaque étape en une ligne : en live coding, le jury suit le raisonnement.

## 0. Cadrer (une minute)

Reformuler la demande en trois points : **qui** (rôle : `employee`, `manager`, `hr_admin`), **quoi** (ressource et comportement observable : méthode, chemin, codes HTTP, champs JSON, écran), **règle métier** (ce qui est permis ou refusé, et pourquoi).

Règles de cadrage :
- **Ne pas modifier une opération d'API existante** : pas de champ retiré ou renommé, pas de code HTTP changé, pas de chemin déplacé. Ajouter une opération, ou un champ **optionnel** dans une réponse, est permis (les E2E tolèrent les ajouts). Si la demande impose de changer l'existant, s'arrêter et le dire : il faut une ADR acceptée (ADR-005 §2).
- Si un point est ambigu (règle métier, rôle), poser **une** question, avec une proposition par défaut.

## 1. Repérer, sans explorer

1. Lire [`CODEMAP.md`](../../../CODEMAP.md). Trouver l'**opération voisine** : même rôle, même ressource, même verbe si possible. C'est le modèle à imiter.
2. Ouvrir **seulement** les fichiers que la carte liste pour cette route : route, composition, cas d'usage, port, adaptateur, et le `*.test.ts` du cas d'usage ou du domaine. Recherche ciblée (`grep`) permise ensuite, pour un symbole précis.
3. **Ne pas lire** (trop longs et inutiles pour coder) : `docs/adr/*` en entier, `docs/audit/`, `docs/tests/E2E.md` en entier, `docs/index.html` en entier, `src/types/api.d.ts`, `src/generated/`, `package-lock.json`, `eslint-suppressions.json`. Pour une ADR, lire seulement le paragraphe cité.

Tranche de référence, si aucune voisine ne colle mieux : **la décision d'une note** (`POST /api/manager/expense-notes/[id]/approve`).

| Couche | Fichier modèle | Rôle |
|---|---|---|
| Route | `src/app/api/manager/expense-notes/[id]/approve/route.ts` | garde, validation, appel du cas d'usage, DTO : 15 lignes |
| Composition | `src/composition/decisions.ts` | `new CasDUsage(new AdaptateurPostgres())` |
| Cas d'usage | `src/application/DecideExpenseNote.ts` | orchestre, ne dépend que des ports |
| Domaine | `src/domain/validation/DecideExpenseNote.ts` (+ `.test.ts`) | règle pure, erreurs métier (`ExpenseNoteNotVisible` → 404, `ExpenseNoteAlreadyDecided` → 409) |
| Port | `src/ports/ExpenseNoteDecisionRepository.ts` | interface et type de retour |
| Adaptateur | `src/adapters/PostgresExpenseNoteDecisionRepository.ts` | `withUserScope`, SQL paramétré, `SELECT … FOR UPDATE`, outbox dans la même transaction |
| DTO | `src/http/expenseNote.ts` | ligne SQL → JSON du contrat |
| E2E | `e2e/manager-approval.spec.ts` (`MGR-06` à `MGR-09`) | fixtures `org` et `apiAs`, une entreprise par test |

## 2. Planifier, puis attendre le feu vert

Présenter un plan court **avant d'écrire du code** : fichiers créés ou modifiés, couche par couche, dans l'ordre de l'étape 3, l'ID du test E2E ajouté (préfixe du fichier visé, numéro suivant), et ce qui ne change pas. En live coding, attendre la validation.

## 3. Coder, couche par couche

Ne faire que les étapes nécessaires ; garder cet ordre.

1. **Contrat** : modifier `openapi.yaml` d'abord (opération, schémas, codes d'erreur), puis `npm run generate:api`. Importer les types depuis `src/http/dto.ts` ou `src/types/api.d.ts` ; ne jamais éditer un fichier généré.
2. **Migration**, si le schéma change : nouveau fichier `migrations/<horodatage>_<nom>.sql` avec `-- Up Migration` et `-- Down Migration` ; jamais d'édition d'une migration existante. Une nouvelle table de données tenant : `company_id`, `ENABLE` et `FORCE ROW LEVEL SECURITY`, une policy, et les `GRANT` minimaux à `expense_app` (et à `expense_worker` si le worker la lit), sur le modèle de `migrations/1793028373424_rls-isolation-tenant.sql`. Puis `npm run migrate:up`.
3. **Domaine** : la règle métier, pure (pas de `pg`, `next`, `aws-sdk`, auth), dans `src/domain/<sous-domaine>/`, avec son `*.test.ts` à côté. Les refus sont des classes d'erreur du domaine.
4. **Port** dans `src/ports/`, puis **adaptateur** dans `src/adapters/` : `withUserScope(actorId, …)` de `src/lib/db.ts` ; SQL paramétré (`$1`) ; filtre par entreprise même si la RLS existe ; liste blanche pour un tri ou un champ dynamique.
5. **Cas d'usage** dans `src/application/` : ne dépend que des ports et du domaine ; test Vitest avec un port factice.
6. **Composition** : brancher le cas d'usage sur son adaptateur dans `src/composition/` (fichier existant de la même ressource, ou nouveau).
7. **Route** fine, sur le modèle de la tranche de référence :

   ```ts
   export const POST = withApiErrors('/api/…', async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
     const session = await auth()
     const actor = requireRole(session, 'manager') // ou requireRole(session) : une session suffit
     if (actor instanceof Response) return actor
     const { id } = await params
     validateId(id)
     // corps : const input = validateInput('<Schéma du contrat>', await request.json()) (src/http/validation.ts)
     const result = await casDUsage.execute(/* … */)
     return Response.json(toDto(result))
   })
   ```

   La garde ouvre le handler : le test d'architecture refuse une route sans elle. Pas de SQL ni de règle métier ici.
8. **Nouvelle erreur métier** : code dans `openapi.yaml`, entrée dans `problemCatalogue` (`src/http/problem.ts`), traduction de l'erreur dans `respondError` (`src/http/errors.ts`), libellé français dans `src/components/apiError.ts`. Jamais de message interne ni de pile au client.
9. **Asynchrone** (email, IA, traitement long) : type d'événement dans le domaine, émis dans la transaction de l'adaptateur via l'outbox, handler déclaré dans `src/worker/handlers.ts` (`handle` court et transactionnel, ou `run` long, hors transaction et idempotent). Modèle : `src/adapters/PgNotificationEvents.ts` et `src/worker/notificationHandlers.ts`.
10. **UI**, si demandée : composant dans `src/components/`, page mince ; appels via `fetch('/api/…')` comme les composants voisins.

## 4. Tester

- **Unitaire** (Vitest, `npx vitest run <fichier>`) : la règle du domaine et le cas d'usage, cas permis **et** refusés.
- **E2E** (Playwright) : un `test('[PREFIX-NN] …')` dans la spec de la ressource (ou une nouvelle spec), avec les fixtures `org` et `apiAs` de `e2e/support/fixtures.ts` ; au minimum le cas nominal, le refus de rôle (403) et l'**isolation entre entreprises** (`createOrg('…-autre')`). Ajouter la ligne de l'ID dans `docs/tests/E2E.md`, section du fichier.
- Ne jamais modifier, désactiver ni supprimer un test existant pour faire passer la suite.

## 5. Documenter

1. `npm run generate:architecture` : régénère `CODEMAP.md`, les graphes et leur recopie dans `docs/index.html`. Relire le diff.
2. Mettre à jour la doc des développeurs selon le tableau de [`docs/agents/documentation.md`](../../../docs/agents/documentation.md) (nouvelle table → `docs/architecture/vues/schema.mmd`, nouvel événement → section outbox, etc.).

## 6. Valider, puis rendre compte

1. `npm run check` (lint, types, unitaires, contrat, architecture) : vert obligatoire.
2. E2E : `npx playwright test -g "<ID>"` pour le nouveau test, puis les specs que `CODEMAP.md` cite pour les routes touchées. Avant une PR : `make test-e2e`.
3. Récapituler en quelques lignes : fichiers touchés par couche, tests ajoutés, résultats, et **ce qui n'a pas été lancé**.

## Pièges fréquents

- `401` = pas de session, `403` = mauvais rôle, `404` = ressource non visible pour l'appelant (jamais `403` pour une note d'une autre entreprise : cela révèle qu'elle existe).
- Montants : `numeric` en base, `number` dans le DTO (conversion dans `src/http/`). Dates : chaîne `YYYY-MM-DD`.
- Un import interdit entre couches fait échouer `npm run check` : passer par un port ou par la composition, ne jamais ajouter d'exception dans `scripts/architecture/layers.ts` ni dans les listes `LEGACY_*` d'`eslint.config.mjs`.
- Un composant `'use client'` n'importe jamais `src/composition/`.
- Pas de nouvelle dépendance npm sans justification.
