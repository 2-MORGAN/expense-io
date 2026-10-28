# CLAUDE.md — Expense.io

Guide pour tout agent IA (et tout humain) qui modifie ce dépôt. Court par choix : il est chargé à chaque tâche. Le détail vit dans les fichiers cités, à ouvrir seulement quand la tâche le demande.

**Pour ajouter ou modifier une fonctionnalité : skill `/nouvelle-fonctionnalite`** (`.claude/skills/nouvelle-fonctionnalite/SKILL.md`). **Pour savoir quels fichiers ouvrir : [`CODEMAP.md`](CODEMAP.md)** (généré, vérifié par `npm run check`), avant toute exploration.

## Contexte

Expense.io est un SaaS B2B de notes de frais (NDF), **multi-tenant** : un tenant = une entreprise (`companies`). Projet de cours ARLA (EPITA SIGL) : audit d'architecture puis refacto. Contrainte absolue : **ne pas casser le comportement existant** — les correcteurs rejouent leurs tests E2E (sur l'API, avec les comptes du seed) et les nôtres doivent rester verts. On n'a pas le droit de modifier les API existantes : on peut en ajouter.

```
Employé ──soumet NDF + reçu──▶ pending ──Manager direct──▶ approved | rejected
Manager racine (manager_id NULL) ──soumet──▶ pending ──RH de l'entreprise──▶ approved | rejected
```

Rôles : `employee`, `manager`, `hr_admin` (`manager` ne s'attribue que par seed/base). Inscription sans invitation = nouvelle entreprise dont on est RH, après vérification d'email ; on rejoint une entreprise uniquement par une invitation de sa RH (détail : [`docs/agents/historique.md`](docs/agents/historique.md)).

Stack : Next.js 16 (App Router, route handlers) · React 19 · TypeScript strict · Tailwind 4 · Auth.js v5 (Credentials, JWT) · PostgreSQL 16 via `pg` (SQL brut, **pas d'ORM**) · migrations `node-pg-migrate` · S3 (LocalStack en local) · OCR Tesseract.js · worker d'outbox.

## Commandes

| But | Commande |
|---|---|
| Tout lancer (install, docker, migrations, bucket, seed, dev + worker) | `make dev` → http://localhost:3000 |
| Lint, types, unitaires, contrat, architecture (ce que lance la CI avant le build) | `npm run check` |
| Tests unitaires (Vitest), `*.test.ts` à côté du code testé | `npx vitest run <fichier>` · `npm run test:unit` |
| E2E (Playwright) : un scénario, un fichier, toute la suite | `npx playwright test -g "<ID>"` · `npx playwright test e2e/<x>.spec.ts` · `make test-e2e` |
| Contrat d'API → types et JSON de validation | `npm run generate:api` |
| Graphes d'architecture, `CODEMAP.md` et recopie dans `docs/index.html` | `npm run generate:architecture` |
| Migrations / seed (idempotent) / bucket | `npm run migrate:up` · `npm run migrate:down` · `npm run seed` · `npm run ensure-bucket` |
| Worker seul (outbox : OCR, emails) | `make worker` · `npm run worker` |

Postgres : port **5433**. LocalStack : **4567**. Mailpit : SMTP **1025**, interface **http://localhost:8025**. Comptes de démo : `hr@expense.io` / `hr1234`, `manager@expense.io` / `manager1234`, `demo@expense.io` / `demo1234`. Autres commandes (couverture, nettoyage, build) : [`docs/agents/harnais.md`](docs/agents/harnais.md).

## Harnais de validation

Décidé par l'ADR-005 : hooks git (pre-commit : lint ; pre-push : `npm run check`), CI obligatoire (`check` et `e2e`), et hooks Claude Code versionnés dans `.claude/settings.json` (`PreToolUse` refuse les contournements, `Stop` lance `npm run check` si le code a changé). Tableau complet, lint, SonarQube et graphes : [`docs/agents/harnais.md`](docs/agents/harnais.md). **Après un pull ou un changement de branche, `npm install`** si `package.json` ou `package-lock.json` a changé.

1. **Avant de déclarer une tâche terminée**, `npm run check` doit passer. Si le changement touche `src/app`, `src/lib`, `migrations/` ou `scripts/`, lancer aussi les E2E concernés (specs citées par `CODEMAP.md`, IDs dans `docs/tests/E2E.md`) ou toute la suite. Dire explicitement ce qui n'a pas été lancé.
2. **Un bug corrigé = un test** vu en échec avant la correction, en succès après : test Vitest à côté du code pour une règle métier, scénario Playwright avec un ID dans `e2e/` pour un comportement HTTP, UI ou en base.
3. **Un test E2E rouge est une régression** : corriger le code, pas le test. Ne jamais modifier, désactiver ni supprimer un test existant pour faire passer la CI. Si un test doit changer, s'arrêter et demander : il faut une ADR acceptée (ADR-005 §2).
4. **Ne rien contourner** : jamais de `--no-verify`, jamais de push sur `main`, jamais de `eslint-disable` sans commentaire qui le justifie, jamais de `eslint --suppress-all` ni `--suppress-rule`, jamais d'ajout aux listes d'exceptions (`LEGACY_*` d'`eslint.config.mjs`, `LEGACY_EDGES` et `PUBLIC_ROUTES` de `scripts/architecture/layers.ts`, `eslint-suppressions.json`) : elles ne font que raccourcir.
5. **PR** : `gh pr create --repo 2-MORGAN/expense-io --base main`, en remplissant le modèle (`.github/pull_request_template.md`). Sans `--repo`, `gh` peut viser le dépôt parent du fork.

## Où placer le code

La liste des fichiers par route, page et worker est dans [`CODEMAP.md`](CODEMAP.md) ; les couches et leurs droits d'import dans `scripts/architecture/layers.ts` (ADR-002 §3.3, vérifiés par `npm run check`). Chemin d'une requête : route `src/app/api/**/route.ts` → cas d'usage `src/application/` (branché dans `src/composition/`) → domaine `src/domain/` et ports `src/ports/` → adaptateurs `src/adapters/`.

- **Règle métier** (statuts, qui peut valider quoi, calculs) → `src/domain/`. Pas d'import de `pg`, `next`, `aws-sdk`, `auth`. Testable sans infrastructure.
- **Cas d'usage** → `src/application/`, ne dépend que du domaine et des ports ; branché sur ses adaptateurs dans `src/composition/` (ADR-006). Réutiliser avant de créer.
- **Dépendance externe** (base, S3, email, OCR) → interface dans `src/ports/`, implémentation dans `src/adapters/`.
- **Route handler** (`route.ts`) → fine couche HTTP : garde (`auth()` puis `requireRole()`), validation par le contrat, appel du cas d'usage, DTO (`src/http/`). **Pas de SQL ni de règle métier dans un route handler.**
- **Traitement asynchrone** (email, OCR, IA) → un type d'événement émis dans la transaction via l'outbox, et un handler déclaré dans `src/worker/handlers.ts` : `handle(event, client)` court, dans la transaction ; `run(event, signal)` long, hors transaction, idempotent (exemple : `src/worker/receiptAnalysis.ts`).
- **Accès base** → via `withUserScope()` de `src/lib/db.ts`, jamais `getPool().query` direct pour des données tenant.
- **Schéma** → nouvelle migration dans `migrations/` (horodatée, `-- Up Migration` / `-- Down Migration`, jamais d'édition d'une migration existante) ; RLS et `GRANT` minimaux pour `expense_app` et `expense_worker`.
- **UI** → `src/components/` ; les pages restent minces ; un composant `'use client'` n'importe jamais `src/composition/`.

## Documentation développeur

[`docs/index.html`](docs/index.html) est la doc d'accueil des développeurs, en schémas ; ses schémas Mermaid vivent dans `docs/architecture/` (générés depuis le code, ou vues écrites à la main dans `vues/`). **La doc fait partie du changement** : tout changement de code met à jour la page et ses vues dans la même PR, puis `npm run generate:architecture`. Quoi mettre à jour selon le changement, et ce que `npm run check` vérifie : [`docs/agents/documentation.md`](docs/agents/documentation.md), à lire à la fin d'une tâche. Rien à mettre à jour : le dire dans la rubrique « Documentation » de la PR.

## Conventions

- TypeScript strict, pas de `any`. Alias d'import `@/*` → `src/*`. Guillemets simples, pas de point-virgule, indentation 2 espaces (suivre le style des fichiers voisins).
- Code et identifiants en anglais ; messages de l'API en anglais avec un `code` stable, traduits par le front (ADR-004) ; interface et docs en français.
- Montants : `numeric` en base, converti en `number` à la frontière. Dates : chaîne `YYYY-MM-DD` (parser `pg` OID 1082 volontairement brut, ne pas le changer).
- Un changement = une branche + une PR, relue par un pair. Petites PR. Pas de nouvelle dépendance npm sans justification dans la PR.
- Toute décision d'architecture structurante → une ADR courte dans `docs/adr/` (modèle : `ADR-000-modele.md`). **Seules les ADR au statut « Acceptée » font foi** : voir l'index [`docs/adr/README.md`](docs/adr/README.md).

## Contrat HTTP

- `openapi.yaml` fait foi (ADR-004). Modifier le contrat **en premier**, puis `npm run generate:api` ; lire `docs/api/README.md` avant de toucher une opération métier.
- Importer les types HTTP depuis `src/types/api.d.ts` (alias dans `src/http/dto.ts`) ; ne pas recréer de DTO locaux ni modifier les fichiers générés.
- Validation par les schémas du contrat (`validateInput`, `validateId` de `src/http/validation.ts`), sans coercition destructive, après la garde et avant toute écriture ou upload. Le domaine reste indépendant des DTO HTTP.
- Nouvelle erreur : code dans `openapi.yaml`, `problemCatalogue` (`src/http/problem.ts`), `respondError` (`src/http/errors.ts`), libellé dans `src/components/apiError.ts`.

## Règles non négociables (sécurité & multi-tenant)

1. **Isolation par entreprise** : toute requête sur des données tenant doit être bornée par `company_id` / par le scope utilisateur. Ne jamais faire confiance à un id venant du client sans vérifier qu'il appartient au tenant de l'appelant.
2. **Autorisation côté serveur, à chaque route**, y compris les routes de reçus. Ne jamais supposer qu'une vérification a été faite en amont (`proxy.ts` ne protège pas `/api`).
3. **Zéro concaténation SQL** : requêtes paramétrées (`$1`, `$2`…). Pour un tri ou un champ dynamique, utiliser une liste blanche explicite.
4. **Secrets uniquement via variables d'environnement** (`.env.example` fait foi). Ne jamais coder un secret en dur, ne jamais committer `.env`.
5. **Erreurs** : ne jamais renvoyer message interne ou stacktrace au client. `application/problem+json` (RFC 9457), 401 = non authentifié, 403 = non autorisé, 404 si la ressource n'est pas visible par l'appelant. Le détail va au journal : `logError()` de `src/lib/log.ts`, jamais `console.error(error)`.
6. **Reçus** : clés S3 non devinables et préfixées par tenant ; accès uniquement par URL pré-signée de courte durée après contrôle d'autorisation.
7. **Opérations multi-étapes** (insert + upload S3 + update) : atomiques ou compensées, et idempotentes quand c'est rejouable.

## Dette connue

À ne pas reproduire, ni « corriger au passage » dans une PR sans rapport (ouvrir un sujet dédié) : `src/utils/` n'est importé par aucun code ; la règle « qui voit quoi » vit à deux endroits (domaine pour une note, `WHERE` de `PostgresExpenseNoteListRepository` pour les listes) : les garder alignées. Détail, et liste de ce qui est déjà corrigé : [`docs/agents/historique.md`](docs/agents/historique.md).

## Ce qu'il ne faut pas lire pour coder

Longs, et inutiles pour une fonctionnalité : `docs/adr/*` en entier (lire le paragraphe cité), `docs/audit/`, `docs/tests/E2E.md` en entier (chercher l'ID), `docs/index.html` en entier, `docs/agents/historique.md`, `src/types/api.d.ts`, `src/generated/`, `package-lock.json`, `eslint-suppressions.json`. Pour savoir où est quelque chose : `CODEMAP.md`, puis une recherche ciblée.

## Façon de travailler (pour l'IA)

1. Repérer avec `CODEMAP.md`, puis lire les fichiers de l'opération voisine **et leurs voisins** ; imiter les conventions locales.
2. Pour une nouvelle fonctionnalité : skill `/nouvelle-fonctionnalite` (contrat, domaine et test, port et adaptateur, cas d'usage, composition, route fine, E2E, doc).
3. Préserver le comportement observable existant (codes de réponse, formats JSON, parcours UI) sauf demande explicite ; sinon l'écrire dans la PR.
4. Écrire ou mettre à jour les tests avec le code. Un bug corrigé = un test qui échoue avant, passe après.
5. Rester dans le périmètre demandé : pas de refacto opportuniste, pas de fichiers superflus.
6. En cas de doute d'architecture, proposer plusieurs options avec leurs compromis plutôt que trancher en silence ; une décision structurante appelle une ADR.
7. Mettre à jour la doc des développeurs dans le même changement que le code (« Documentation développeur » ci-dessus).
