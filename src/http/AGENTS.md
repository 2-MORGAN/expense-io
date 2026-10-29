# src/http — briques HTTP communes

Consignes du dossier, en complément du [CLAUDE.md](../../CLAUDE.md) de la racine, qui reste la référence. Chemins donnés depuis la racine du dépôt.

Ce que partagent les routes : garde de rôle, traduction des erreurs en `application/problem+json` (RFC 9457), validation par le contrat OpenAPI, mise en forme des DTO, lecture des formulaires multipart. Une route compose ces briques et n'en réécrit aucune.

## Peut importer

Recopié depuis `scripts/architecture/layers.ts` par `npm run generate:architecture` : ne rien écrire entre les marqueurs. Un droit nouveau se justifie dans la PR (ADR-002).

<!-- début : imports permis -->

| Module | Peut importer |
|---|---|
| `src/http` | `src/modules/expenses/application`, `src/modules/identity/application`, `src/modules/receipt-analysis/application`, `src/modules/validation/application`, `src/composition`, `src/modules/expenses/domain`, `src/modules/identity/domain`, `src/modules/receipt-analysis/domain`, `src/modules/validation/domain`, `src/generated`, `src/http`, `src/lib/auth`, `src/lib/authErrors`, `src/lib/errors`, `src/lib/log`, `src/ports`, `src/types`, `src/utils`, `next`, `next-auth` |

<!-- fin : imports permis -->

## Les briques

| Besoin | Brique |
|---|---|
| 401 sans session, 403 rôle refusé | `requireRole(session, 'manager')`, `src/http/requireRole.ts` |
| Toute erreur levée → problème RFC 9457, sans détail interne, journalisé | `withApiErrors('/api/…', handler)`, `src/http/withApiErrors.ts` |
| Corps JSON, schéma du contrat, id | `readJsonBody`, `validateInput('NomDuSchema', body)`, `validateId(id)`, `src/http/validation.ts` |
| Erreur du domaine → code et statut | `respondError`, `src/http/errors.ts` |
| Catalogue des codes d'erreur | `problemCatalogue`, `src/http/problem.ts` |
| Note de frais en JSON | `toExpenseNoteDto`, `src/http/expenseNote.ts` |
| Types des corps | `src/http/dto.ts`, alias de `src/types/api.d.ts` (généré, ne pas modifier) |

## Ajouter un code d'erreur

1. Contrat : l'ajouter à l'énumération `Problem.code` et aux réponses de l'opération dans `openapi.yaml`, puis `npm run generate:api`.
2. `problemCatalogue` : statut, titre et détail en anglais, texte public uniquement. Le type refuse un code oublié.
3. `respondError` : traduire l'erreur du domaine en ce code.
4. Son message français dans `src/components/apiError.ts` (même garde par le type).
5. La section « API et contrat » de `docs/index.html`.

## Pièges

- Jamais `error.message` ni une valeur soumise dans une réponse : seulement le texte du catalogue. Le détail va au journal.
- Validation sans coercition ni valeur par défaut : un refus ne modifie jamais la donnée.
- Ordre : session et rôle, puis l'entrée, puis toute écriture ou upload.
- Une seule garde : ne pas créer un second `requireRole` ni un wrapper qui autorise. `scripts/architecture/routes.ts` lit les gardes ; un wrapper de plus se justifie dans la PR.

## Tests

`*.test.ts` à côté, couverture mesurée : `src/http/requireRole.test.ts`, `src/http/withApiErrors.test.ts`.

## Vérifié par

- `npm run check:api` : contrat valide, artefacts générés à jour, chaque méthode et chemin couverts.
- `scripts/architecture/architecture.test.ts` : la matrice ci-dessus.
