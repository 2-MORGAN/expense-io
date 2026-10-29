# src/app — pages, server actions et routes hors /api

Consignes du dossier, en complément du [CLAUDE.md](../../CLAUDE.md) de la racine, qui reste la référence. Chemins donnés depuis la racine du dépôt. Les routes de l'API ont leurs consignes : `src/app/api/AGENTS.md`.

App Router de Next.js 16. Les pages restent minces : elles lisent la session et rendent des composants de `src/components`. `src/app/actions` contient les server actions (connexion, inscription), `src/app/verify-email` la route du lien de vérification d'email.

## Peut importer

Recopié depuis `scripts/architecture/layers.ts` par `npm run generate:architecture` : ne rien écrire entre les marqueurs. Un droit nouveau se justifie dans la PR (ADR-002). La ligne `src/app` vaut pour les pages.

<!-- début : imports permis -->

| Module | Peut importer |
|---|---|
| `src/app` | `src/modules/expenses/domain`, `src/modules/identity/domain`, `src/modules/receipt-analysis/domain`, `src/modules/validation/domain`, `src/app/actions`, `src/generated`, `src/http`, `src/types`, `src/utils`, `next`, `react`, `src/components`, `src/composition`, `src/lib/auth`, `next-auth` |
| `src/app/actions` | `src/modules/expenses/application`, `src/modules/identity/application`, `src/modules/receipt-analysis/application`, `src/modules/validation/application`, `src/composition`, `src/modules/expenses/domain`, `src/modules/identity/domain`, `src/modules/receipt-analysis/domain`, `src/modules/validation/domain`, `src/modules/expenses/ports`, `src/modules/identity/ports`, `src/modules/receipt-analysis/ports`, `src/modules/validation/ports`, `src/generated`, `src/http`, `src/lib/auth`, `src/lib/authErrors`, `src/lib/errors`, `src/lib/log`, `src/ports`, `src/types`, `src/utils`, `next`, `next-auth` |
| `src/app/verify-email` | `src/modules/expenses/application`, `src/modules/identity/application`, `src/modules/receipt-analysis/application`, `src/modules/validation/application`, `src/composition`, `src/modules/expenses/domain`, `src/modules/identity/domain`, `src/modules/receipt-analysis/domain`, `src/modules/validation/domain`, `src/modules/expenses/ports`, `src/modules/identity/ports`, `src/modules/receipt-analysis/ports`, `src/modules/validation/ports`, `src/generated`, `src/http`, `src/lib/auth`, `src/lib/authErrors`, `src/lib/errors`, `src/lib/log`, `src/ports`, `src/types`, `src/utils`, `next`, `next-auth` |

<!-- fin : imports permis -->

## Ajouter une page

1. Un dossier sous `src/app` avec son `page.tsx`, composant serveur par défaut : il peut lire la session (`auth()`) et appeler un cas d'usage par `src/composition`.
2. Ce qui est interactif va dans un composant `'use client'` de `src/components`, qui passe par l'API (`fetch('/api/…')`).
3. Page réservée à un rôle : l'ajouter à `PROTECTED_PREFIXES` dans `src/proxy.ts` (redirection vers `/login`), et vérifier le rôle dans la page pour l'affichage (`src/app/hr/page.tsx`). La vraie autorisation reste dans les routes de l'API.
4. Textes en français ; lien dans la navigation si la page doit être trouvée (`src/components/NavItem.tsx`).

## Ajouter une server action

`'use server'` en tête (`src/app/actions/auth.ts`). Elle lit le `FormData`, appelle un cas d'usage par la composition et renvoie un état de formulaire avec des messages français. Une action qui exige une session la vérifie elle-même, comme une route.

## Exemples à copier

- `src/app/hr/page.tsx` : page serveur réservée à un rôle.
- `src/app/expenses/page.tsx` : page client qui appelle l'API et traduit ses erreurs (`responseErrorMessage`).
- `src/app/actions/auth.ts` : server actions et messages de formulaire.

## Pièges

- Un fichier `'use client'` n'importe jamais `src/composition` ni `src/lib/db`.
- Textes, libellés et rôles ARIA sont lus par les E2E (`getByRole`, `getByLabel`) : en changer un casse un test existant ; en ajouter est libre.
- Pas de SQL ni d'accès base, même dans un composant serveur.

## Vérifié par

- ESLint (`expense-io/routes-and-ui`) : ni `pg`, ni `src/lib/db`, ni texte SQL.
- `scripts/architecture/architecture.test.ts` : la matrice ci-dessus, aucun `'use client'` qui importe la composition, garde de la route `verify-email` (publique, déclarée dans `PUBLIC_ROUTES`).
- Une page client se teste aussi comme un composant, en `page.test.tsx` à côté, réseau simulé (`src/app/expenses/page.test.tsx`, `src/components/AGENTS.md`).
- E2E des parcours (`e2e/`).
