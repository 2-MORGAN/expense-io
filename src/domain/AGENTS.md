# src/domain — règles métier pures

Consignes du dossier, en complément de l'[AGENTS.md](../../AGENTS.md) de la racine, qui reste la référence. Chemins donnés depuis la racine du dépôt.

Ici vivent les règles : statuts, qui peut voir ou trancher quoi, calculs, validation métier, types d'événements de l'outbox. Du TypeScript pur, testé en millisecondes, sans base, sans HTTP, sans SDK.

## Peut importer

Recopié depuis `scripts/architecture/layers.ts` par `npm run generate:architecture` : ne rien écrire entre les marqueurs. Un droit nouveau se justifie dans la PR (ADR-002).

<!-- début : imports permis -->

| Module | Peut importer |
|---|---|
| `src/domain` | `src/generated`, `src/ports`, `src/utils` |

<!-- fin : imports permis -->

## Ajouter une règle

1. Choisir le contexte : `src/domain/expense` (notes, reçus, tri), `src/domain/validation` (décision), `src/domain/identity` (inscription, invitation), `src/domain/receipt` (OCR). Un contexte nouveau = un sous-dossier nouveau.
2. Écrire d'abord le test `*.test.ts` à côté, le voir échouer : `npx vitest src/domain`.
3. Une fonction pure ou une petite classe. Entrées et sorties typées par des interfaces du domaine (`ReceiptViewer`, `ReceiptOwner`), jamais par une ligne SQL ni un DTO HTTP.
4. Un refus est une erreur nommée (`class ReceiptNotVisible extends Error`) ; la couche HTTP la traduit en code d'erreur dans `src/http/errors.ts`.
5. Un type d'événement de l'outbox est une constante `export const X = 'contexte.action'` ici, avec la construction et la garde de type de son payload.

## Exemples à copier

- `src/domain/expense/ReceiptAccess.ts` et son test : règle d'accès, erreur du domaine, un cas par périmètre.
- `src/domain/expense/NoteSort.ts` : liste blanche réduite à une clé fermée, que l'adaptateur traduit en requête fixe.
- `src/domain/Notification.ts` : types d'événements, payloads et gardes `isXPayload`.

## Pièges

- « Qui voit quoi » existe aussi dans le `WHERE` des listes (`src/adapters/PostgresExpenseNoteListRepository.ts`) : faire évoluer les deux ensemble.
- Note absente et note d'une autre entreprise donnent la même erreur (404) : ne jamais révéler qu'une ressource existe.
- Dates en chaîne `YYYY-MM-DD`, jamais `Date` (fuseau horaire).
- Pas de `Math.random()` ni d'horloge cachée : recevoir la date ou l'id en paramètre, pour que le test soit déterministe (`invitationExpiry(now)` dans `src/domain/identity/identity.ts`).

## Vérifié par

- ESLint (`expense-io/domain` dans `eslint.config.mjs`) : aucun import de `pg`, `next`, `react`, d'un SDK, de `src/lib`, `src/adapters`, `src/application`, `src/app`, `src/components`.
- `scripts/architecture/architecture.test.ts` : la matrice ci-dessus, et chaque type d'événement cité dans `docs/index.html`.
- Couverture unitaire mesurée ici : `npm run test:coverage`.
