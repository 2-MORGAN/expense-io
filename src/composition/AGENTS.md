# src/composition — branchement des cas d'usage

Consignes du dossier, en complément de l'[AGENTS.md](../../AGENTS.md) de la racine, qui reste la référence. Chemins donnés depuis la racine du dépôt.

Le seul endroit, côté serveur web, où l'on crée les adaptateurs (`new PostgresXxx()`) et où on les donne aux cas d'usage. Routes, server actions et pages serveur importent d'ici un cas d'usage déjà branché.

## Peut importer

Recopié depuis `scripts/architecture/layers.ts` par `npm run generate:architecture` : ne rien écrire entre les marqueurs. Un droit nouveau se justifie dans la PR (ADR-002).

<!-- début : imports permis -->

| Module | Peut importer |
|---|---|
| `src/composition` | `src/adapters`, `src/application`, `src/domain`, `src/lib/auth`, `src/lib/db`, `src/lib/email`, `src/lib/log`, `src/lib/outbox`, `src/lib/storage`, `src/lib/tokens`, `src/ports`, `src/utils` |

<!-- fin : imports permis -->

## Ajouter un branchement

- Un fichier par famille de cas d'usage (`decisions.ts`, `expenseNoteLists.ts`, `identity.ts`…) qui exporte des instances prêtes : `export const getReceiptUrl = new GetReceiptUrl(new PostgresReceiptAccessRepository(), new S3ReceiptAdapter())`.
- Ni logique ni condition. Un choix qui dépend de l'environnement se fait dans une fabrique de `src/lib` (`createEmailSender` dans `src/lib/email.ts`).

## Exemples à copier

- `src/composition/receiptUrls.ts` et `src/composition/decisions.ts`.

## Pièges

- Jamais importé par un fichier `'use client'` : la composition tirerait `pg` et le SDK S3 dans le navigateur.
- Le worker est un processus à part qui fait sa propre composition (`src/worker`) ; il peut réutiliser une instance d'ici (`src/composition/ocr.ts`).

## Vérifié par

- `scripts/architecture/architecture.test.ts` : la matrice ci-dessus, et aucun fichier `'use client'` qui importe la composition.
