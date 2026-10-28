# Harnais de validation : le détail

Détail de la section « Harnais de validation » de [`CLAUDE.md`](../../CLAUDE.md), décidé par l'[ADR-005](../adr/ADR-005-harnais-de-validation.md). Les règles à suivre sont dans `CLAUDE.md` ; ce fichier explique ce qui tourne, quand, et comment réagir à un échec.

## Ce qui vérifie le code, et quand

| Moment | Ce qui tourne | Durée |
|---|---|---|
| `git commit` | hook pre-commit : ESLint avec cache | ≈ 3 s, 5 s à froid |
| `git push` | hook pre-push : `npm run check` (lint, types, tests unitaires, contrat, architecture) | ≈ 35 s |
| À la demande | E2E ciblés : `npx playwright test -g "<ID>"` (réutilise le serveur de `make dev`) · toute la suite : `make test-e2e` · tout ce que fait la CI : `make verify` | ≈ 3 min pour la suite, Docker requis |
| PR et push sur `main` | CI : `check` (lint, types, tests unitaires, build) et `e2e` (`make test-e2e`), obligatoires pour fusionner | ≈ 1 min et 3 min 30 |
| Claude Code : avant une commande shell | hook `PreToolUse` (`.claude/hooks/guard-git.mjs`) : refuse `--no-verify`, `git commit -n`, `HUSKY=0`, la modification de `core.hooksPath`, le push sur `main`, le force-push, `gh pr create` sans `--repo` explicite ou vers le dépôt du cours, et `eslint --suppress-all` ou `--suppress-rule` | instantané |
| Claude Code : fin de tour | hook `Stop` (`.claude/hooks/check-on-stop.mjs`) : `npm run check` si le code a changé depuis le dernier check vert ; rouge, le tour continue une fois avec l'erreur, puis l'utilisateur est averti | ≈ 35 s |

Les hooks git (husky) s'installent avec `npm install` (script `prepare`). Ils donnent un retour rapide ; la garantie, c'est la CI. Les hooks Claude Code sont déclarés dans `.claude/settings.json`, versionné : ne pas les désactiver pour avancer, un refus signale un contournement du harnais.

## Lint

`npm run lint` fait respecter une partie des règles de placement (`eslint.config.mjs`, ADR-005 T6) : domaine sans infrastructure ; ni SQL ni accès base dans `src/app/` et `src/components/` ; `getPool()` réservé à `src/lib/db.ts` ; pas de SQL interpolé ; pas de test `.only`, `.skip`, `.fixme` ou `.fail`. Le code existant qui enfreint une règle est listé en exception (listes `LEGACY_*`). Ces listes ne font que raccourcir : retirer un fichier dès qu'il est conforme, **ne jamais en ajouter un** pour faire passer le lint.

Le lint applique aussi les règles de SonarQube (`eslint-plugin-sonarjs`) : bugs, failles (regex au temps super-linéaire, donc ReDoS ; secrets en dur ; cookies ; cryptographie…) et code fragile. Leurs constats dans le code existant sont figés dans `eslint-suppressions.json`, par fichier et par règle. Un nouveau constat fait échouer le lint : corriger le code. Après une correction, la suppression devenue inutile fait aussi échouer le lint : `npx eslint --prune-suppressions` la retire, et le fichier se commite avec la correction. Ce fichier ne fait que raccourcir.

## Graphes d'architecture et carte du code

Les graphes de [`docs/architecture/`](../architecture/README.md) complètent le lint. Le test `scripts/architecture/architecture.test.ts` (dans `npm run check`) vérifie la matrice entière des couches (`scripts/architecture/layers.ts`, ADR-002 §3.3) et la garde de chaque méthode de route, puis compare au code les graphes Mermaid versionnés et la carte du code [`CODEMAP.md`](../../CODEMAP.md). Un graphe ou une carte qui a dérivé se régénère avec `npm run generate:architecture` et se commite avec le code. Une flèche interdite ou une route sans garde se corrigent dans le code, jamais en régénérant ni en ajoutant une exception (`LEGACY_EDGES` et `PUBLIC_ROUTES` ne font que raccourcir). Une nouvelle couche ou un nouveau droit se justifient dans la PR.

## Commandes moins courantes

| But | Commande |
|---|---|
| Couverture de code (à la demande, sans seuil bloquant : ADR-005) | unitaires : `npm run test:coverage` → `coverage/index.html` (interface : `npm run test:coverage:ui`) · E2E, serveur et worker compris : `npm run test:e2e:coverage` → `coverage-e2e-report/index.html` (Docker requis, ne réutilise pas le serveur de `make dev`, à arrêter avant) ; citer les **branches**, les lignes E2E sont gonflées |
| Reçus orphelins sur S3 (2-476) | `npm run reconcile:orphan-receipts` (dry-run) · `npm run reconcile:orphan-receipts -- --execute` |
| Nettoyage unique des notes sans reçu (2-476) | `npm run clean:notes-without-receipt` (dry-run) · `npm run clean:notes-without-receipt -- --execute --out <dossier>` |
| Build prod | `npm run build` |
| Reset des données locales | `make clean` |
