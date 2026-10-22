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

Signup **actuel** : le premier compte d'un domaine email crée l'entreprise et devient RH, les suivants la rejoignent comme employés. **C'est la faille S7, à corriger** (ADR-001 §3, ticket 2-496) : le domaine ne donnera plus aucun droit, s'inscrire sans invitation créera sa propre entreprise et rejoindre une entreprise passera par une invitation de sa RH avec vérification d'email. Ne pas s'appuyer sur la règle de domaine dans du nouveau code. Mettre ce paragraphe à jour dans la PR qui applique 2-496.

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
| Worker (outbox : emails, puis OCR) | `make worker` · `npm run worker` (second terminal) |
| Build prod | `npm run build` |
| Reset des données locales | `make clean` |

Postgres : port **5433**. LocalStack : port **4567**. Mailpit : SMTP **1025**, interface **http://localhost:8025** (tous les emails de dev y arrivent, aucun ne sort). Comptes de démo (seed) : `hr@expense.io` / `hr1234`, `manager@expense.io` / `manager1234`, `demo@expense.io` / `demo1234`.

**Avant de déclarer une tâche terminée** : `npm run check` (lint, types et tests unitaires) doit passer, et les tests E2E rester verts. Si un test ou une vérification n'a pas pu être lancé, le dire explicitement.

## Où placer le code

État actuel du dépôt :

```
src/
├── app/
│   ├── api/**/route.ts      # route handlers (HTTP) : auth/, expense-notes/, manager/, hr/
│   ├── actions/auth.ts      # server actions signup/login/logout
│   └── {expenses,manager,hr,login,signup}/page.tsx
├── components/              # composants React (AdminConsole, PendingApprovalsPanel, NavItem)
├── lib/                     # auth.ts, db.ts, storage.ts, ocr.ts, errors.ts
├── domain/                  # ExpenseNote.ts, User.ts   (entités métier)
├── ports/                   # NotificationPort, ReceiptStoragePort (interfaces)
├── adapters/                # ConsoleNotificationAdapter, S3ReceiptAdapter
├── utils/                   # validators.ts, format.ts
├── worker/                  # processus de l'outbox : main.ts, handlers.ts (registre), processNextEvent.ts
└── proxy.ts                 # garde de navigation (ne couvre PAS /api)
migrations/                  # SQL versionné — seule source de vérité du schéma
scripts/                     # seed.mjs, ensure-bucket.mjs
```

Règles de placement pour tout **nouveau** code :

- **Règle métier** (statuts, qui peut valider quoi, calculs) → `src/domain/`. Pas d'import de `pg`, `next`, `aws-sdk`, `auth`. Testable sans infrastructure.
- **Dépendance externe** (S3, notifications, OCR, queue) → interface dans `src/ports/`, implémentation dans `src/adapters/`. Le domaine et les cas d'usage ne dépendent que du port.
- **Route handler** (`route.ts`) → fine couche HTTP : authentifier, valider l'entrée, appeler le domaine/cas d'usage, formater la réponse. **Pas de SQL ni de règle métier dans un route handler.**
- **Traitement asynchrone** (email, OCR…) → un type d'événement dans l'outbox et un handler déclaré dans `src/worker/handlers.ts` ; le worker (`npm run worker`) ne traite que les types déclarés.
- **Accès base** → via `withUserScope()` de `src/lib/db.ts`, jamais `getPool().query` direct pour des données tenant.
- **Schéma** → nouvelle migration dans `migrations/` (horodatée, jamais d'édition d'une migration existante), avec `down`.
- **UI** → `src/components/` ; les pages restent minces.
- Réutiliser avant de créer : `src/domain`, `src/ports`, `src/adapters` et `src/utils` existent déjà mais sont **actuellement inutilisés** (voir dette). Les brancher plutôt que dupliquer.

`npm run lint` fait respecter une partie de ces règles (`eslint.config.mjs`, ADR-005 T6) : domaine sans infrastructure ; ni SQL ni accès base dans `src/app/` et `src/components/` ; `getPool()` réservé à `src/lib/db.ts` ; pas de SQL interpolé ; pas de test `.only`, `.skip`, `.fixme` ou `.fail`. Le code existant qui enfreint une règle est listé en exception (listes `LEGACY_*`). Ces listes ne font que raccourcir : retirer un fichier dès qu'il est conforme, **ne jamais en ajouter un** pour faire passer le lint.

## Conventions

- TypeScript strict, pas de `any`. Alias d'import `@/*` → `src/*`.
- Le projet utilise des guillemets simples, pas de point-virgule, indentation 2 espaces (suivre le style des fichiers voisins).
- Code et identifiants en anglais ; messages de l'API en anglais avec un `code` stable, traduits par le front (ADR-004) ; interface et docs en français.
- Montants : `numeric` en base, converti en `number` à la frontière. Dates : chaîne `YYYY-MM-DD` (parser `pg` OID 1082 volontairement brut, ne pas le changer).
- Un changement = une branche + une PR, relue par un pair. Pas de push direct sur `main`. Petites PR.
- Toute décision d'architecture structurante → une ADR courte dans `docs/adr/` (contexte, options, décision, conséquences). **Seules les ADR au statut « Acceptée » font foi** : voir l'index [`docs/adr/README.md`](docs/adr/README.md). Un test E2E ne se modifie que si une ADR acceptée décide le changement de comportement (ADR-005 §2).
- Pas de nouvelle dépendance npm sans justification dans la PR.

## Règles non négociables (sécurité & multi-tenant)

1. **Isolation par entreprise** : toute requête sur des données tenant doit être bornée par `company_id` / par le scope utilisateur. Ne jamais faire confiance à un id venant du client sans vérifier qu'il appartient au tenant de l'appelant.
2. **Autorisation côté serveur, à chaque route**, y compris les routes de reçus. Ne jamais supposer qu'une vérification a été faite en amont (`proxy.ts` ne protège pas `/api`).
3. **Zéro concaténation SQL** : requêtes paramétrées (`$1`, `$2`…). Pour un tri ou un champ dynamique, utiliser une liste blanche explicite.
4. **Secrets uniquement via variables d'environnement** (`.env.example` fait foi). Ne jamais coder un secret en dur, ne jamais committer `.env`.
5. **Erreurs** : ne jamais renvoyer message interne ou stacktrace au client. Cible : `application/problem+json` (RFC 9457), 401 = non authentifié, 403 = non autorisé, 404 si la ressource n'est pas visible par l'appelant.
6. **Reçus** : clés S3 non devinables et préfixées par tenant ; accès uniquement par URL pré-signée de courte durée après contrôle d'autorisation.
7. **Opérations multi-étapes** (insert + upload S3 + update) : atomiques ou compensées, et idempotentes quand c'est rejouable.

## Dette connue (ne pas reproduire, corriger quand le chantier correspondant est en cours)

Constats de l'audit en cours — chacun à vérifier avant de s'y fier :

- Injection SQL via `?sort=` dans `api/expense-notes/route.ts` ; IDOR sur `api/manager/expense-notes/[id]/receipt-url` ; rattachement manager cross-tenant dans `api/hr/users/[id]/manager`.
- RLS probablement contournée (connexion en superuser, policy RH sans `company_id`) : l'isolation repose en pratique sur les `WHERE` manuels.
- `AUTH_SECRET` codé en dur dans `lib/auth.ts` ; `lib/errors.ts` renvoie la stacktrace au client.
- Inscription : l'entreprise et le rôle RH sont déduits du domaine email (S7, voir plus haut).
- `domain/`, `ports/`, `adapters/`, `utils/` jamais importés ; `toExpenseNote()` et les contrôles de rôle dupliqués dans ~8 routes.
- OCR Tesseract synchrone dans la requête HTTP, sans limite de taille ; création de NDF non atomique.
- Aucun contrat d'API (OpenAPI), pas d'observabilité.

Déjà corrigé : codes **401** sans session / **403** rôle refusé sur toutes les routes (Q1.1, PR #8) ; tests unitaires (Vitest, dans `npm run check` et la CI) et règles d'architecture vérifiées par le lint (2-489) ; notifications de soumission et de décision par email via l'outbox (A6, 2-484).

Ne pas « corriger au passage » un de ces points dans une PR sans rapport : ouvrir un sujet dédié. Constats détaillés : [`docs/audit/`](docs/audit/) ; décisions : [`docs/adr/`](docs/adr/) ; tickets : projet Linear ARLA, jalon J4.

## Façon de travailler (pour l'IA)

1. Lire les fichiers concernés **et leurs voisins** avant de modifier ; imiter les conventions locales.
2. Pour une nouvelle fonctionnalité : domaine d'abord (règle + test), puis port/adapter si dépendance externe, puis route fine, puis UI.
3. Préserver le comportement observable existant (codes de réponse, formats JSON, parcours UI) sauf demande explicite ; sinon l'écrire dans la PR.
4. Écrire ou mettre à jour les tests avec le code. Un bug corrigé = un test qui échoue avant, passe après.
5. Rester dans le périmètre demandé : pas de refacto opportuniste, pas de fichiers superflus.
6. En cas de doute d'architecture, proposer plusieurs options avec leurs compromis plutôt que trancher en silence ; une décision structurante appelle une ADR.
