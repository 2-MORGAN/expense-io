# scripts — outils du dépôt

Consignes du dossier, en complément du [CLAUDE.md](../CLAUDE.md) de la racine, qui reste la référence. Chemins donnés depuis la racine du dépôt.

Scripts Node lancés par `package.json` : poste de dev (`scripts/dev.mjs`, `scripts/seed.mjs`, `scripts/ensure-bucket.mjs`), base (`scripts/provision-db-roles.mjs`), contrat (`scripts/generate-api.mjs`, `scripts/check-api.mjs`), exploitation (`scripts/reconcile-orphan-receipts.mjs`, `scripts/clean-notes-without-receipt.mjs`), mesure d'usage (`scripts/analytics-setup.mjs`, `scripts/analytics-demo.mjs`), et en TypeScript les contrôles d'architecture et de doc (`scripts/architecture`) et la couverture (`scripts/coverage`).

## Ajouter un script

1. Une entrée dans `package.json` (`"nom:action": "node scripts/nom.mjs"`), citée dans « Commandes » de `CLAUDE.md` et « Démarrer » de `docs/index.html`.
2. En tête, un commentaire : ce qu'il fait, pourquoi (ticket, ADR), ses options.
3. Réglages par l'environnement (`dotenv`, variables de `.env.example`), jamais en dur.
4. La bonne connexion : `WORKER_DATABASE_URL` (soumise à la RLS) par défaut ; `MIGRATION_DATABASE_URL` (propriétaire) seulement pour le schéma, le seed ou un nettoyage ponctuel.

## Script qui modifie des données

- Dry-run par défaut, rapport seul ; `--execute` pour agir (`scripts/reconcile-orphan-receipts.mjs`).
- Idempotent : relancé, il ne fait rien de plus.
- Re-vérifier chaque élément juste avant d'agir ; exporter ce qui est supprimé (`--out`, `scripts/clean-notes-without-receipt.mjs`).
- Jamais `--execute` sur une base partagée sans un dry-run relu.

## scripts/architecture

Lit `src/`, régénère `docs/architecture/layers.mmd` et `docs/architecture/routes.mmd`, recopie les schémas dans `docs/index.html` et le bloc « Peut importer » des `AGENTS.md` (`npm run generate:architecture`), puis vérifie le tout dans `npm run check`. La matrice des couches est `scripts/architecture/layers.ts`, la liste des dossiers qui ont des consignes `scripts/architecture/agents.ts`. `LEGACY_EDGES` et `PUBLIC_ROUTES` ne font que raccourcir ; une couche ou un droit nouveau se justifie dans la PR.

## Pièges

- ESLint et Vitest couvrent aussi `scripts/` : un `*.test.ts` à côté pour toute logique non triviale.
- Un script qui touche la base ou S3 se teste en E2E (`e2e/orphan-receipts.spec.ts`, `e2e/receipt-cleanup.spec.ts`).
