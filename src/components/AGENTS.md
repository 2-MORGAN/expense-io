# src/components — interface React

Consignes du dossier, en complément du [CLAUDE.md](../../CLAUDE.md) de la racine, qui reste la référence. Chemins donnés depuis la racine du dépôt.

Composants de l'interface, en français, stylés avec Tailwind 4 (variantes `dark:` comprises). Un composant interactif est `'use client'` et ne parle au serveur que par l'API HTTP.

## Peut importer

Recopié depuis `scripts/architecture/layers.ts` par `npm run generate:architecture` : ne rien écrire entre les marqueurs. Un droit nouveau se justifie dans la PR (ADR-002).

<!-- début : imports permis -->

| Module | Peut importer |
|---|---|
| `src/components` | `src/app/actions`, `src/domain`, `src/generated`, `src/http`, `src/types`, `src/utils`, `next`, `react` |

<!-- fin : imports permis -->

## Ajouter un composant

1. Un fichier `PascalCase.tsx` qui exporte une fonction nommée, commentée en une ligne (`/** Invitation d'un salarié par la RH (S7) : … */`).
2. Données : `fetch('/api/…')`, corps typés par le contrat (`import type { ExpenseNote } from '@/http/dto'`), jamais un type recopié à la main.
3. Erreurs : `responseErrorMessage(response)` ou `apiErrorMessage(body)` de `src/components/apiError.ts` traduisent le `code` du problème en français. Jamais le texte anglais de l'API à l'écran.
4. Formulaires accessibles : un `<label htmlFor>` par champ, des boutons nommés. Les E2E et les lecteurs d'écran s'en servent.
5. Montants et dates : `Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' })` et `Intl.DateTimeFormat('fr-FR', …)`.

## Exemples à copier

- `src/components/PendingApprovalsPanel.tsx` : liste chargée par l'API, actions, erreurs traduites.
- `src/components/apiError.ts` et son test : la table de traduction des codes.

## Pièges

- Pas d'import de `src/composition`, de `src/lib` ni de `pg` : un composant client part dans le navigateur.
- Avant de modifier un texte affiché, chercher les E2E qui le lisent dans `e2e/`.
- Un nouveau code d'erreur de l'API sans traduction ici ne compile pas : c'est voulu.

## Tests

Un composant se teste à côté de lui, en `*.test.tsx` (projet `components` de `vitest.config.mts`, jsdom et Testing Library, lancé par `npm run check`) : le rendre, agir comme l'utilisateur (`userEvent`, rôles et libellés comme les E2E), simuler le réseau route par route (`stubFetch` de `integration/support/fetch.ts`, réponses au format du contrat). Les états d'erreur, une panne serveur comprise, s'y vérifient ; les parcours restent en E2E. Modèle : `src/components/PendingApprovalsPanel.test.tsx`.

## Vérifié par

- ESLint (`expense-io/routes-and-ui`) et `scripts/architecture/architecture.test.ts`.
- Tests de composants (`npm run check`) et E2E des parcours (`e2e/`).
