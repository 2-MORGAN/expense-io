# src/ports — interfaces vers l'extérieur

Consignes du dossier, en complément de l'[AGENTS.md](../../AGENTS.md) de la racine, qui reste la référence. Chemins donnés depuis la racine du dépôt.

Un port est une interface TypeScript que le cœur (`src/application`, `src/domain`) appelle et qu'un adaptateur de `src/adapters` implémente : base, S3, OCR, email, outbox. Rien d'exécutable ici : des types, et quelques erreurs partagées (`NonRetryableError`).

## Peut importer

Recopié depuis `scripts/architecture/layers.ts` par `npm run generate:architecture` : ne rien écrire entre les marqueurs. Un droit nouveau se justifie dans la PR (ADR-002).

<!-- début : imports permis -->

| Module | Peut importer |
|---|---|
| `src/ports` | `src/domain` |

<!-- fin : imports permis -->

## Ajouter un port

1. Nommer l'interface d'après le besoin : `ReceiptAccessRepository`, `NotificationPort`, pas d'après la technique.
2. Une méthode par intention, commentée en une ligne (`/** Notes en attente de ses subordonnés directs, plus anciennes d'abord. */`). Le filtrage se fait dans la requête de l'adaptateur, pas en mémoire.
3. Entrées et sorties : des types du domaine, ou une forme de lecture déclarée dans le port (`ListedExpenseNote`). Jamais un DTO HTTP (`src/http/dto.ts`), jamais un type de `pg` ou du SDK AWS.
4. `null` pour « absent ou pas visible » quand le cas d'usage doit trancher (`findReceipt`).
5. L'implémenter dans `src/adapters`, la brancher dans `src/composition`.

## Exemples à copier

- `src/ports/ReceiptAccessRepository.ts` : lecture seule, `null` si pas visible.
- `src/ports/ExpenseNoteListRepository.ts` : une méthode par intention, commentée.
- `src/ports/EventOutbox.ts` : port de l'outbox et erreur définitive.

## Pièges

- Pas de « repository générique » qui exposerait `query()` ou du SQL : un port par besoin.
- Un port ou un adaptateur nouveau met à jour `docs/architecture/vues/hexagone.mmd` et la section « Ports et adaptateurs » de `docs/index.html`.

## Vérifié par

- `scripts/architecture/architecture.test.ts` : un port n'importe que le domaine.
