# CLAUDE.md — Expense.io

Guide pour tout agent IA (et tout humain) qui modifie ce dépôt. À lire en entier avant d'écrire du code.

## Contexte

Expense.io est un SaaS B2B de notes de frais (NDF), **multi-tenant** : un tenant = une entreprise (`companies`). Projet de cours ARLA (EPITA SIGL) : audit d'architecture puis refacto. Contrainte absolue : **ne pas casser le comportement existant** — les tests E2E sont rejoués par les correcteurs.

Workflow métier :

```
Employé ──soumet NDF + reçu──▶ pending ──Manager direct──▶ approved | rejected
Manager racine (manager_id NULL) ──soumet──▶ pending ──RH de l'entreprise──▶ approved | rejected
```

Rôles : `employee`, `manager`, `hr_admin`. `manager` ne s'attribue que par seed/base.

Inscription (S7 corrigée, ADR-001 §3, 2-496) : le domaine de l'email ne donne **aucun droit**. S'inscrire sans invitation crée sa propre entreprise, dont on devient RH ; la connexion n'est possible qu'après le lien de vérification reçu par email. Un compte non vérifié ne bloque pas son adresse : une nouvelle inscription ou une invitation acceptée le remplace (`purge_unverified_account`), et l'email de vérification peut être renvoyé depuis `/signup/verify`. On rejoint une entreprise uniquement par une **invitation de sa RH** (`/hr`, `POST /api/hr/invitations`) : lien à usage unique, valable 7 jours, qui vaut vérification d'email. Les jetons ne sont stockés qu'en empreinte SHA-256 ; le worker les crée à l'envoi (l'outbox ne transporte que des ids). Inscription, acceptation et vérification passent par des fonctions `SECURITY DEFINER` (`register_user`, `accept_invitation`, `verify_email`…).

## Stack

Next.js 16 (App Router, route handlers) · React 19 · TypeScript strict · Tailwind 4 · Auth.js v5 (Credentials, JWT) · PostgreSQL 16 via `pg` (SQL brut, **pas d'ORM**) · migrations `node-pg-migrate` · S3 (LocalStack en local) · OCR Tesseract.js.

## Commandes

| But | Commande |
|---|---|
| Tout lancer (install, docker, migrations, bucket, seed, dev) | `make dev` → http://localhost:3000 |
| Lint / types | `npm run lint` · `npm run typecheck` |
| Tests unitaires (Vitest) | `npm run test:unit` · `npx vitest` (relance à chaque modification) — fichier `*.test.ts` à côté du code testé, exemple : `src/utils/validators.test.ts` |
| Lint, types et tests unitaires d'un coup (ce que lance la CI avant le build) | `npm run check` |
| Tests E2E de non-régression (Playwright) | `make test-e2e` · `npm run test:e2e` — voir `docs/tests/E2E.md` |
| Migrations | `npm run migrate:up` · `npm run migrate:down` |
| Seed (idempotent) / bucket | `npm run seed` · `npm run ensure-bucket` |
| Worker (outbox : analyse OCR, puis emails) | lancé par `npm run dev` / `make dev` ; seul : `make worker` · `npm run worker` |
| Build prod | `npm run build` |
| Reset des données locales | `make clean` |

Postgres : port **5433**. LocalStack : port **4567**. Mailpit : SMTP **1025**, interface **http://localhost:8025** (tous les emails de dev y arrivent, aucun ne sort). Comptes de démo (seed) : `hr@expense.io` / `hr1234`, `manager@expense.io` / `manager1234`, `demo@expense.io` / `demo1234`.

## Harnais de validation

Décidé par l'ADR-005. Ce qui vérifie le code, et quand :

| Moment | Ce qui tourne | Durée |
|---|---|---|
| `git commit` | hook pre-commit : ESLint avec cache | ≈ 3 s, 5 s à froid |
| `git push` | hook pre-push : `npm run check` (lint, types, tests unitaires) | ≈ 25 s |
| À la demande | E2E ciblés : `npx playwright test -g "<ID>"` (réutilise le serveur de `make dev`) · toute la suite : `make test-e2e` · tout ce que fait la CI : `make verify` | ≈ 3 min pour la suite, Docker requis |
| PR et push sur `main` | CI : `check` (lint, types, tests unitaires, build) et `e2e` (`make test-e2e`), obligatoires pour fusionner | ≈ 1 min et 3 min 30 |
| Claude Code : avant une commande shell | hook `PreToolUse` (`.claude/hooks/guard-git.mjs`) : refuse `--no-verify`, `git commit -n`, `HUSKY=0`, la modification de `core.hooksPath`, le push sur `main`, le force-push, et `gh pr create` sans `--repo` explicite ou vers le dépôt du cours | instantané |
| Claude Code : fin de tour | hook `Stop` (`.claude/hooks/check-on-stop.mjs`) : `npm run check` si le code a changé depuis le dernier check vert ; rouge, le tour continue une fois avec l'erreur, puis l'utilisateur est averti | ≈ 25 s |

Les hooks git (husky) s'installent avec `npm install` (script `prepare`). Ils donnent un retour rapide ; la garantie, c'est la CI. Les hooks Claude Code sont déclarés dans `.claude/settings.json`, versionné : ne pas les désactiver pour avancer, un refus signale un contournement du harnais.

**Après un pull ou un changement de branche, lancer `npm install`** si `package.json` ou `package-lock.json` a changé : sinon une dépendance manque (Vitest, `@playwright/test`, husky…) et `npm run check` échoue, à la main comme dans le hook.

1. **Avant de déclarer une tâche terminée**, `npm run check` doit passer. Si le changement touche `src/app`, `src/lib`, `migrations/` ou `scripts/`, lancer aussi les E2E concernés (IDs dans `docs/tests/E2E.md`) ou toute la suite. Dire explicitement ce qui n'a pas été lancé.
2. **Un bug corrigé = un test** vu en échec avant la correction, en succès après : test Vitest à côté du code pour une règle métier, scénario Playwright avec un ID dans `e2e/` pour un comportement HTTP, UI ou en base.
3. **Un test E2E rouge est une régression** : corriger le code, pas le test. Ne jamais modifier, désactiver ni supprimer un test existant pour faire passer la CI. Si un test doit changer, s'arrêter et demander : il faut une ADR acceptée (ADR-005 §2).
4. **Ne rien contourner** : jamais de `--no-verify`, jamais de push sur `main`, jamais de `eslint-disable` sans commentaire qui le justifie.
5. **PR** : `gh pr create --repo 2-MORGAN/expense-io --base main`, en remplissant le modèle (`.github/pull_request_template.md`). Sans `--repo`, `gh` peut viser le dépôt parent du fork.

## Où placer le code

État actuel du dépôt :

```
src/
├── app/
│   ├── api/**/route.ts      # route handlers (HTTP) : auth/, expense-notes/, manager/, hr/
│   ├── actions/auth.ts      # server actions signup/login/logout
│   └── {expenses,manager,hr,login,signup}/page.tsx
├── components/              # composants React (AdminConsole, PendingApprovalsPanel, NavItem)
├── application/             # cas d'usage OCR synchrones et asynchrones
├── composition/             # branchement des ports et adaptateurs OCR
├── http/                    # transport et problèmes HTTP du module OCR
├── lib/                     # auth.ts, db.ts, storage.ts, errors.ts, outbox.ts, email.ts, log.ts (journal JSON)
├── domain/                  # ExpenseNote.ts, User.ts   (entités métier)
├── ports/                   # stockage, OCR, analyses, exécution et outbox
├── adapters/                # S3, Tesseract isolé et persistance PostgreSQL
├── utils/                   # validators.ts, format.ts
├── worker/                  # processus de l'outbox : main.ts, handlers.ts (registre), processNextEvent.ts
├── instrumentation.ts       # journalise les erreurs captées par Next.js (onRequestError)
└── proxy.ts                 # garde de navigation (ne couvre PAS /api)
migrations/                  # SQL versionné — seule source de vérité du schéma
scripts/                     # seed.mjs, ensure-bucket.mjs
```

Règles de placement pour tout **nouveau** code :

- **Règle métier** (statuts, qui peut valider quoi, calculs) → `src/domain/`. Pas d'import de `pg`, `next`, `aws-sdk`, `auth`. Testable sans infrastructure.
- **Dépendance externe** (S3, notifications, OCR, queue) → interface dans `src/ports/`, implémentation dans `src/adapters/`. Le domaine et les cas d'usage ne dépendent que du port.
- **Route handler** (`route.ts`) → fine couche HTTP : authentifier, valider l'entrée, appeler le domaine/cas d'usage, formater la réponse. **Pas de SQL ni de règle métier dans un route handler.**
- **Traitement asynchrone** (email, OCR…) → un type d'événement dans l'outbox et un handler déclaré dans `src/worker/handlers.ts` ; le worker (`npm run worker`) ne traite que les types déclarés. Traitement court : `handle(event, client)`, dans la transaction de l'événement ; traitement long (OCR, IA) : `run(event, signal)`, hors transaction, idempotent (exemple : `src/worker/receiptAnalysis.ts`).
- **Accès base** → via `withUserScope()` de `src/lib/db.ts`, jamais `getPool().query` direct pour des données tenant.
- **Schéma** → nouvelle migration dans `migrations/` (horodatée, jamais d'édition d'une migration existante), avec `down`.
- **UI** → `src/components/` ; les pages restent minces.
- Réutiliser avant de créer : le module OCR branche déjà ses cas d'usage, ports et adaptateurs. Les classes historiques `ExpenseNote`, `User` et plusieurs utilitaires restent à brancher (voir dette).

`npm run lint` fait respecter une partie de ces règles (`eslint.config.mjs`, ADR-005 T6) : domaine sans infrastructure ; ni SQL ni accès base dans `src/app/` et `src/components/` ; `getPool()` réservé à `src/lib/db.ts` ; pas de SQL interpolé ; pas de test `.only`, `.skip`, `.fixme` ou `.fail`. Le code existant qui enfreint une règle est listé en exception (listes `LEGACY_*`). Ces listes ne font que raccourcir : retirer un fichier dès qu'il est conforme, **ne jamais en ajouter un** pour faire passer le lint.

## Conventions

- TypeScript strict, pas de `any`. Alias d'import `@/*` → `src/*`.
- Le projet utilise des guillemets simples, pas de point-virgule, indentation 2 espaces (suivre le style des fichiers voisins).
- Code et identifiants en anglais ; messages de l'API en anglais avec un `code` stable, traduits par le front (ADR-004) ; interface et docs en français.
- Montants : `numeric` en base, converti en `number` à la frontière. Dates : chaîne `YYYY-MM-DD` (parser `pg` OID 1082 volontairement brut, ne pas le changer).
- Un changement = une branche + une PR, relue par un pair. Pas de push direct sur `main`. Petites PR.
- Toute décision d'architecture structurante → une ADR courte dans `docs/adr/` (contexte, options, décision, conséquences). **Seules les ADR au statut « Acceptée » font foi** : voir l'index [`docs/adr/README.md`](docs/adr/README.md). Un test E2E ne se modifie que si une ADR acceptée décide le changement de comportement (ADR-005 §2).
- Pas de nouvelle dépendance npm sans justification dans la PR.

## Contrat HTTP

- Lire `openapi.yaml` et `docs/api/README.md` avant de modifier une opération métier. Modifier le contrat en premier, puis `npm run generate:api`.
- Importer les types HTTP depuis `src/types/api.d.ts` (alias possibles dans `src/http/dto.ts`) ; ne pas recréer de DTO locaux ni modifier les fichiers générés.
- Les validateurs utilisent les schémas du contrat, sans coercition/default destructif. Vérifier toute entrée avant écriture/upload, après session/rôle ; le domaine reste indépendant des DTO HTTP.
- `npm run check:api` est inclus dans `npm run check` : lint OpenAPI, artefacts à jour et couverture méthode/chemin, réexports compris. Les réponses API E2E sont contrôlées contre le contrat.

## Règles non négociables (sécurité & multi-tenant)

1. **Isolation par entreprise** : toute requête sur des données tenant doit être bornée par `company_id` / par le scope utilisateur. Ne jamais faire confiance à un id venant du client sans vérifier qu'il appartient au tenant de l'appelant.
2. **Autorisation côté serveur, à chaque route**, y compris les routes de reçus. Ne jamais supposer qu'une vérification a été faite en amont (`proxy.ts` ne protège pas `/api`).
3. **Zéro concaténation SQL** : requêtes paramétrées (`$1`, `$2`…). Pour un tri ou un champ dynamique, utiliser une liste blanche explicite.
4. **Secrets uniquement via variables d'environnement** (`.env.example` fait foi). Ne jamais coder un secret en dur, ne jamais committer `.env`.
5. **Erreurs** : ne jamais renvoyer message interne ou stacktrace au client. Cible : `application/problem+json` (RFC 9457), 401 = non authentifié, 403 = non autorisé, 404 si la ressource n'est pas visible par l'appelant. Le détail va au journal du serveur : `logError()` de `src/lib/log.ts` (une ligne JSON avec message et pile, sans email ni URL pré-signée, ADR-005 §5), jamais `console.error(error)` ; une erreur qui échappe aux `catch` y arrive par `src/instrumentation.ts`.
6. **Reçus** : clés S3 non devinables et préfixées par tenant ; accès uniquement par URL pré-signée de courte durée après contrôle d'autorisation.
7. **Opérations multi-étapes** (insert + upload S3 + update) : atomiques ou compensées, et idempotentes quand c'est rejouable.

## Dette connue (ne pas reproduire, corriger quand le chantier correspondant est en cours)

Constats de l'audit en cours — chacun à vérifier avant de s'y fier :

- RLS contournée tant que l'application se connecte en superuser : l'isolation repose en pratique sur les `WHERE` manuels. Policies bornées par l'entreprise, RLS sur `users` et rôle restreint `expense_app` en place (2-478, tests ISO-07) ; la connexion bascule sur `expense_app` avec 2-481.
- Classes métier historiques encore inutilisées ; `toExpenseNote()` et les contrôles de rôle dupliqués dans ~8 routes. Le module OCR utilise désormais domaine, cas d'usage, ports et adaptateurs.
- Création de NDF non atomique (2-476). Les bornes OCR et son parcours asynchrone, branché sur le socle commun de l'outbox (2-484), sont décrits dans `docs/ocr.md`.
- Contrat global dans `openapi.yaml`, types et JSON de validation générés (2-486). Erreurs communes sans détail interne et traductions front (2-485), logger serveur de 2-490 réutilisé.

Déjà corrigé : codes **401** sans session / **403** rôle refusé sur toutes les routes (Q1.1, PR #8) ; tests unitaires (Vitest, dans `npm run check` et la CI) et règles d'architecture vérifiées par le lint (2-489) ; OCR : montant lu sur la dernière ligne de total chiffrée, « TTC » en priorité, et description suggérée (nom du commerçant), règles pures dans `src/domain/receipt/parseReceiptText.ts` (PR #17) ; sécurité WS1 (2-471) : tri `?sort=` par liste blanche (S1), reçu manager limité à son équipe (S2), rattachement limité aux managers de l'entreprise (S3), `AUTH_SECRET` lu dans l'environnement (S5) ; identité (2-496) : invitations par la RH et vérification d'email du créateur, le domaine ne donne plus aucun droit (S7), rôle relu en base à chaque requête et session de 8 h d'inactivité (S9).

Ne pas « corriger au passage » un de ces points dans une PR sans rapport : ouvrir un sujet dédié. Constats détaillés : [`docs/audit/`](docs/audit/) ; décisions : [`docs/adr/`](docs/adr/) ; tickets : projet Linear ARLA, jalon J4.

## Façon de travailler (pour l'IA)

1. Lire les fichiers concernés **et leurs voisins** avant de modifier ; imiter les conventions locales.
2. Pour une nouvelle fonctionnalité : domaine d'abord (règle + test), puis port/adapter si dépendance externe, puis route fine, puis UI.
3. Préserver le comportement observable existant (codes de réponse, formats JSON, parcours UI) sauf demande explicite ; sinon l'écrire dans la PR.
4. Écrire ou mettre à jour les tests avec le code. Un bug corrigé = un test qui échoue avant, passe après.
5. Rester dans le périmètre demandé : pas de refacto opportuniste, pas de fichiers superflus.
6. En cas de doute d'architecture, proposer plusieurs options avec leurs compromis plutôt que trancher en silence ; une décision structurante appelle une ADR.
