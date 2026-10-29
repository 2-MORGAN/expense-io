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
| Couverture de code (à la demande, sans seuil bloquant : ADR-005) | unitaires : `npm run test:coverage` → `coverage/index.html` (interface : `npm run test:coverage:ui`) · E2E, serveur et worker compris : `npm run test:e2e:coverage` → `coverage-e2e-report/index.html` (Docker requis, ne réutilise pas le serveur de `make dev`, à arrêter avant) ; citer les **branches**, les lignes E2E sont gonflées |
| Migrations | `npm run migrate:up` · `npm run migrate:down` |
| Seed (idempotent) / bucket | `npm run seed` · `npm run ensure-bucket` |
| Reçus orphelins sur S3 (2-476) | `npm run reconcile:orphan-receipts` (dry-run) · `npm run reconcile:orphan-receipts -- --execute` |
| Nettoyage unique des notes sans reçu (2-476) | `npm run clean:notes-without-receipt` (dry-run) · `npm run clean:notes-without-receipt -- --execute --out <dossier>` |
| Worker (outbox : analyse OCR, puis emails) | lancé par `npm run dev` / `make dev` ; seul : `make worker` · `npm run worker` |
| Graphes d'architecture, et leur recopie avec les vues dans la doc des développeurs (`docs/index.html`) | `npm run generate:architecture` |
| Build prod | `npm run build` |
| Reset des données locales | `make clean` |
| Observabilité, optionnelle (Grafana : traces, métriques, journaux) | `make observability` → http://localhost:3001, puis `OTEL_EXPORTER_OTLP_ENDPOINT` dans `.env` ; voir `docs/observability.md` |
| Mesure d'usage, optionnelle (Umami : pages vues, événements, heatmap, replays) | `make analytics` → http://localhost:3002, puis `UMAMI_SCRIPT_URL` et `UMAMI_WEBSITE_ID` dans `.env`, et `UMAMI_HEATMAP=true` pour la heatmap et les replays ; données de démonstration : `npm run analytics:demo -- --execute` ; voir `docs/analytics.md` |

Postgres : port **5433**. LocalStack : port **4567**. Mailpit : SMTP **1025**, interface **http://localhost:8025** (tous les emails de dev y arrivent, aucun ne sort). Comptes de démo (seed) : `hr@expense.io` / `hr1234`, `manager@expense.io` / `manager1234`, `demo@expense.io` / `demo1234`.

## Harnais de validation

Décidé par l'ADR-005. Ce qui vérifie le code, et quand :

| Moment | Ce qui tourne | Durée |
|---|---|---|
| `git commit` | hook pre-commit : ESLint avec cache | ≈ 3 s, 5 s à froid |
| `git push` | hook pre-push : `npm run check` (lint, types, tests unitaires) | ≈ 35 s |
| À la demande | E2E ciblés : `npx playwright test -g "<ID>"` (réutilise le serveur de `make dev`) · toute la suite : `make test-e2e` · tout ce que fait la CI : `make verify` · migrations et tests E2E existants inchangés : `make frozen` | ≈ 3 min pour la suite, Docker requis |
| PR et push sur `main` | CI : `check` (lint, types, tests unitaires, build ; sur les PR, contrat sans rupture et migrations et tests E2E existants inchangés) et `e2e` (`make test-e2e`), obligatoires pour fusionner, plus 1 approbation ; le PO fusionne sans approbation, jamais sans CI verte | ≈ 1 min et 3 min 30 |
| Claude Code : avant une commande shell | hook `PreToolUse` (`.claude/hooks/guard-git.mjs`) : refuse `--no-verify`, `git commit -n`, `HUSKY=0`, la modification de `core.hooksPath`, le push sur `main`, le force-push, `gh pr create` sans `--repo` explicite ou vers le dépôt du cours, et `eslint --suppress-all` ou `--suppress-rule` | instantané |
| Claude Code : avant une écriture de fichier | hook `PreToolUse` (`.claude/hooks/guard-frozen.mjs`) : refuse d'écrire dans une migration déjà dans `main`, ou de modifier, désactiver ou retirer un test E2E qui y est déjà ; ajouter une migration ou un test reste libre | ≈ 2 s sur un `.spec.ts`, instantané ailleurs |
| Claude Code : fin de tour | hook `Stop` (`.claude/hooks/check-on-stop.mjs`) : `npm run check` si le code a changé depuis le dernier check vert ; rouge, le tour continue une fois avec l'erreur, puis l'utilisateur est averti | ≈ 35 s |

Les hooks git (husky) s'installent avec `npm install` (script `prepare`). Ils donnent un retour rapide ; la garantie, c'est la CI. Les hooks Claude Code sont déclarés dans `.claude/settings.json`, versionné : ne pas les désactiver pour avancer, un refus signale un contournement du harnais.

**Après un pull ou un changement de branche, lancer `npm install`** si `package.json` ou `package-lock.json` a changé : sinon une dépendance manque (Vitest, `@playwright/test`, husky…) et `npm run check` échoue, à la main comme dans le hook.

1. **Avant de déclarer une tâche terminée**, `npm run check` doit passer. Si le changement touche `src/app`, `src/lib`, `migrations/` ou `scripts/`, lancer aussi les E2E concernés (IDs dans `docs/tests/E2E.md`) ou toute la suite. Dire explicitement ce qui n'a pas été lancé.
2. **Un bug corrigé = un test** vu en échec avant la correction, en succès après : test Vitest à côté du code pour une règle métier, scénario Playwright avec un ID dans `e2e/` pour un comportement HTTP, UI ou en base.
3. **Un test E2E rouge est une régression** : corriger le code, pas le test. Ne jamais modifier, désactiver ni supprimer un test existant pour faire passer la CI. Si un test doit changer, s'arrêter et demander : il faut une ADR acceptée (ADR-005 §2), puis le label `changement-e2e` sur la PR. Le hook `guard-frozen.mjs` et la CI le font respecter, comme pour les migrations déjà dans `main`.
4. **Ne rien contourner** : jamais de `--no-verify`, jamais de push sur `main`, jamais de `eslint-disable` sans commentaire qui le justifie, jamais de `eslint --suppress-all` ni `--suppress-rule` pour faire taire un nouveau constat.
5. **PR** : `gh pr create --repo 2-MORGAN/expense-io --base main`, en remplissant le modèle (`.github/pull_request_template.md`). Sans `--repo`, `gh` peut viser le dépôt parent du fork.

## Où placer le code

État actuel du dépôt :

```
src/
├── app/
│   ├── api/**/route.ts      # route handlers (HTTP) : auth/, expense-notes/, manager/, hr/
│   ├── actions/auth.ts      # server actions signup/login/logout
│   └── {expenses,manager,hr,login,signup}/page.tsx
├── components/              # composants React (AdminConsole, PendingApprovalsPanel, NavItem, UmamiScript) ; analytics.ts : événements d'usage (ADR-008)
├── modules/                 # monolithe modulaire, étape 1 : ports/adapters partagés
│   ├── expenses/domain/     # ExpenseNote, décision, accès reçu, tri, notifications
│   ├── expenses/application/ # soumission, décision, listes, URL de reçu
│   ├── identity/domain/     # User, identité, invitations
│   ├── identity/application/ # signup, invitation, emails d'identité
│   ├── receipt-analysis/domain/ # OCR support : OcrError, Receipt, parseReceiptText, UUID via utils
│   └── receipt-analysis/application/ # analyses, suggestion, capacité, requêtes OCR
├── composition/             # branchement des cas d'usage sur leurs adaptateurs
├── http/                    # transport et problèmes HTTP (traduit les erreurs domaine en problem+json)
├── lib/                     # auth.ts, db.ts, storage.ts, errors.ts, outbox.ts, email.ts, log.ts (journal JSON), telemetry/ (OpenTelemetry, ADR-007)
├── ports/                   # partagés étape 1 : stockage, OCR, analyses, exécution et outbox
├── adapters/                # partagés étape 1 : S3, Tesseract isolé, SMTP, notifications et persistance PostgreSQL
├── utils/                   # validators.ts, format.ts, uuid.ts (noyau partagé : UUID)
├── worker/                  # processus de l'outbox : main.ts, handlers.ts (registre), processNextEvent.ts, outboxStats.ts (métriques)
├── instrumentation.ts       # au démarrage : observabilité si activée, contrôles du secret et du rôle de base ; erreurs captées par Next.js (onRequestError)
└── proxy.ts                 # garde de navigation (ne couvre PAS /api)
```

Règles de placement pour tout **nouveau** code :

- **Règle métier** (statuts, qui peut valider quoi, calculs) → `src/modules/<contexte>/domain/` (`expenses`, `identity`, `receipt-analysis` en support). Pas d'import de `pg`, `next`, `aws-sdk`, `auth`. Testable sans infrastructure. Seul lien autorisé entre domaines : `expenses` → `identity` pour les rôles ; le reste passe par les ports ou `src/utils/uuid.ts`.
- **Dépendance externe** (S3, notifications, OCR, queue) → interface dans `src/ports/`, implémentation dans `src/adapters/` (partagés, étape 1 assumée : la découpe en `modules/*/ports` est le suivi, pas cette PR). Le domaine et les cas d'usage ne dépendent que du port.
- **Route handler** (`route.ts`) → fine couche HTTP : authentifier, valider l'entrée, appeler le domaine/cas d'usage, formater la réponse. **Pas de SQL ni de règle métier dans un route handler.**
- **Traitement asynchrone** (email, OCR…) → un type d'événement dans l'outbox et un handler déclaré dans `src/worker/handlers.ts` ; le worker (`npm run worker`) ne traite que les types déclarés. Traitement court : `handle(event, client)`, dans la transaction de l'événement ; traitement long (OCR, IA) : `run(event, signal)`, hors transaction, idempotent (exemple : `src/worker/receiptAnalysis.ts`).
- **Accès base** → via `withUserScope()` de `src/lib/db.ts`, jamais `getPool().query` direct pour des données tenant.
- **Schéma** → nouvelle migration dans `migrations/` (horodatée, jamais d'édition d'une migration existante), avec `down`.
- **UI** → `src/components/` ; les pages restent minces.
- **Métrique, trace** → `src/lib/telemetry/`, avec l'API `@opentelemetry/api` seule (sans effet tant que la télémétrie est désactivée). Étiquettes à peu de valeurs, jamais d'identifiant d'entreprise ou d'utilisateur, ni d'URL réelle (`docs/observability.md`).
- **Événement d'usage** (ce que fait l'utilisateur dans le navigateur) → déclaré dans `ANALYTICS_EVENTS` (`src/components/analytics.ts`), envoyé par `trackEvent()` après la réponse réussie ; propriétés à valeurs fixes, jamais d'email, d'identifiant ni de montant. Chaque événement répond à une question de l'ADR-008 (`docs/analytics.md`). Une page n'entre dans `HEATMAP_PATHS` (heatmap, replays) que si son adresse ne porte jamais de jeton : `recorder.js` envoie l'URL complète. Ne pas retirer `rr-mask` du `<body>` (`src/app/layout.tsx`) : c'est ce qui garde les replays sans texte (USAGE-03). Ce qui se lit côté serveur relève de la télémétrie, pas d'Umami.
- Réutiliser avant de créer : chaque route passe déjà par un cas d'usage de `src/modules/*/application/`, branché dans `src/composition/` (ADR-006). Les utilitaires de `src/utils/` restent inutilisés (voir dette), sauf `uuid.ts` (noyau partagé).

`npm run lint` fait respecter une partie de ces règles (`eslint.config.mjs`, ADR-005 T6) : domaine sans infrastructure ; ni SQL ni accès base dans `src/app/` et `src/components/` ; `getPool()` réservé à `src/lib/db.ts` ; pas de SQL interpolé ; pas de test `.only`, `.skip`, `.fixme` ou `.fail`. Le code existant qui enfreint une règle est listé en exception (listes `LEGACY_*`). Ces listes ne font que raccourcir : retirer un fichier dès qu'il est conforme, **ne jamais en ajouter un** pour faire passer le lint.

Le lint applique aussi les règles de SonarQube (`eslint-plugin-sonarjs`) : bugs, failles (regex au temps super-linéaire, donc ReDoS ; secrets en dur ; cookies ; cryptographie…) et code fragile. Leurs constats dans le code existant sont figés dans `eslint-suppressions.json`, par fichier et par règle. Un nouveau constat fait échouer le lint : corriger le code. Après une correction, la suppression devenue inutile fait aussi échouer le lint : `npx eslint --prune-suppressions` la retire, et le fichier se commite avec la correction. Ce fichier ne fait que raccourcir.

Les graphes de [`docs/architecture/`](docs/architecture/README.md) complètent le lint. Le test `scripts/architecture/architecture.test.ts` (dans `npm run check`) vérifie la matrice entière des couches (`scripts/architecture/layers.ts`, ADR-002 §3.3) et la garde de chaque méthode de route, puis compare les graphes Mermaid versionnés au code. Un graphe qui a dérivé se régénère avec `npm run generate:architecture` et se commite avec le code. Une flèche interdite ou une route sans garde se corrigent dans le code, jamais en régénérant ni en ajoutant une exception (`LEGACY_EDGES` et `PUBLIC_ROUTES` ne font que raccourcir). Une nouvelle couche ou un nouveau droit se justifient dans la PR.

## Consignes par dossier et recette d'une fonctionnalité

Chaque dossier où l'on écrit du code a son `AGENTS.md` : ce que le dossier contient, ce qu'il peut importer, la recette pas à pas, les fichiers modèles, les tests attendus, les pièges et ce qui le vérifie. Codex, Cursor et Copilot le lisent ; le `CLAUDE.md` voisin l'importe (`@AGENTS.md`), et Claude Code le charge dès qu'il travaille dans le dossier. Ces consignes complètent ce fichier sans le remplacer ; on les modifie dans l'`AGENTS.md`, jamais dans le `CLAUDE.md` voisin.

Dossiers : [`src/modules`](src/modules/AGENTS.md) (domaine et cas d'usage de chaque module), [`src/ports`](src/ports/AGENTS.md), [`src/adapters`](src/adapters/AGENTS.md), [`src/composition`](src/composition/AGENTS.md), [`src/http`](src/http/AGENTS.md), [`src/app/api`](src/app/api/AGENTS.md), [`src/app`](src/app/AGENTS.md), [`src/components`](src/components/AGENTS.md), [`src/lib`](src/lib/AGENTS.md), [`src/worker`](src/worker/AGENTS.md), [`migrations`](migrations/AGENTS.md), [`e2e`](e2e/AGENTS.md), [`scripts`](scripts/AGENTS.md), [`docs`](docs/AGENTS.md).

**Pour une fonctionnalité nouvelle ou qui évolue, suivre la recette** [`.claude/skills/nouvelle-fonctionnalite/SKILL.md`](.claude/skills/nouvelle-fonctionnalite/SKILL.md) (skill `/nouvelle-fonctionnalite` de Claude Code) : cadrer et faire valider un plan, puis contrat, domaine, migration, port et adaptateur, cas d'usage, entrée, E2E, doc, vérifications et PR, jusqu'à sa « Définition de terminé ».

Les consignes se mettent à jour avec le code, dans la même PR. `npm run check` (`scripts/architecture/architecture.test.ts`) échoue si un dossier listé dans `scripts/architecture/agents.ts` perd son `AGENTS.md` ou son `CLAUDE.md`, si un `CLAUDE.md` de dossier fait autre chose qu'importer `AGENTS.md`, si une couche de `scripts/architecture/layers.ts` n'a ni consignes ni exclusion motivée, si le bloc « Peut importer » a dérivé de la matrice (`npm run generate:architecture` le recopie), ou si une consigne (ce fichier compris) cite un chemin, un script npm ou une cible `make` qui n'existe pas. Le reste du texte se relit.

## Documentation développeur

[`docs/index.html`](docs/index.html) est la doc d'accueil des développeurs : services et processus, architecture du code, parcours clés, données, API, choix d'architecture et ADR, en schémas. Elle s'ouvre dans un navigateur. Ses schémas sont des fichiers Mermaid versionnés dans `docs/architecture/` : `layers.mmd` et `routes.mmd`, générés depuis le code, et les vues écrites à la main de `docs/architecture/vues/`. `npm run generate:architecture` les recopie dans la page, entre leurs marqueurs `<!-- début : … -->` et `<!-- fin : … -->`.

**La doc fait partie du changement.** Tout agent (et tout humain) qui modifie le code met à jour la page et ses vues **dans la même PR**, sans attendre qu'on le demande :

| Si le changement… | Mettre à jour |
|---|---|
| change un import entre couches, une couche, une route ou sa garde | `npm run generate:architecture`, relire le diff ; le texte de la section si le sens change |
| ajoute ou retire un service, un processus, un port, un adaptateur, un script, une variable d'environnement | `vues/systeme.mmd`, `vues/hexagone.mmd` ; sections « Démarrer », « Vue d'ensemble », « Ports et adaptateurs », « Déploiement et exploitation » |
| modifie un parcours : soumission, décision, outbox, OCR, inscription, invitation, session | la vue de séquence correspondante et le texte de « Parcours clés » |
| ajoute une migration : table, colonne, policy, rôle, fonction `SECURITY DEFINER` | `vues/schema.mmd` et « Données et isolation » |
| ajoute un type d'événement de l'outbox | le tableau des événements et `vues/outbox.mmd` |
| change une opération HTTP ou un code d'erreur | « API et contrat », après `openapi.yaml` |
| ajoute une ADR ou change son statut | sa fiche (`id="adr-NNN"`) dans « Les ADR », `vues/adr.mmd`, et « Choix d'architecture » si un choix change |
| change une commande, un script npm, un hook, la CI ou une tâche planifiée | « Démarrer », « Harnais de validation », « Déploiement et exploitation », `vues/harnais.mmd` |
| change une règle de placement, une convention ou un fichier modèle d'un dossier ; ajoute un dossier de code | l'`AGENTS.md` du dossier ; un dossier nouveau s'ajoute à `AGENT_DIRS` (`scripts/architecture/agents.ts`) avec ses deux fichiers |
| solde ou crée une dette | « Dette connue » et la fiche de l'ADR concernée |

- Une vue se modifie dans son `.mmd`, jamais entre ses marqueurs dans la page : la recopie l'écraserait. Le texte de la page se modifie directement. Nouvelle vue : créer `docs/architecture/vues/<nom>.mmd`, placer ses marqueurs dans une figure de la page, puis `npm run generate:architecture`.
- `npm run check` échoue si la page a dérivé de ses schémas, si un schéma n'y a pas sa place ou un marqueur plus de schéma, si une ADR de `docs/adr/` n'a pas sa fiche, si `vues/schema.mmd` n'a pas exactement les tables des migrations, si un type d'événement de l'outbox n'est pas cité, ou si un script externe est chargé sans empreinte SRI (`integrity`, `crossorigin`). Le reste du texte ne se vérifie pas : le tableau ci-dessus fait foi.
- Rien dans le tableau ne change (correctif local, test, refacto sans effet visible) : le dire dans la rubrique « Documentation » de la PR. Ce qui n'est plus vrai se corrige ou se retire : une doc fausse est pire qu'une doc absente.

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

- `src/utils/` (`validators.ts`, `format.ts`) n'est importé par aucun code : la validation passe par les schémas du contrat (2-486). Les contrôles de rôle des routes API passent tous par `requireRole()` (2-487) ; seules les pages `/manager` et `/hr` refont le leur, pour l'affichage. Toutes les routes passent par un cas d'usage (ADR-006, 2-536) ; la règle « qui voit quoi » vit dans le domaine pour une note et dans le `WHERE` des listes (`PostgresExpenseNoteListRepository`) : les garder alignées.
- Création de NDF : reçu stocké d'abord puis une seule transaction (2-476 étape 1, `SubmitExpenseNote`) ; renvoi sans doublon par `Idempotency-Key` (étape 2, colonnes `idempotency_key` et `request_fingerprint`) ; nettoyage de l'existant (étape 3) : contrainte `CHECK (receipt_key <> '')` posée `NOT VALID` par migration, puis `npm run clean:notes-without-receipt` (dry-run par défaut ; `-- --execute --out <dossier>` exporte en CSV, supprime les notes `pending` sans reçu, garde les décidées pour la RH et valide la contrainte quand il n'en reste plus). Réconciliation des objets orphelins (bonus) : `npm run reconcile:orphan-receipts` (dry-run par défaut ; `-- --execute` supprime les objets de `receipts/` non référencés par une note ni une analyse OCR et vieux de plus de 24 h), à planifier une fois par jour après un premier dry-run relu. Les bornes OCR et son parcours asynchrone, branché sur le socle commun de l'outbox (2-484), sont décrits dans `docs/ocr.md`.
- Contrat global dans `openapi.yaml`, types et JSON de validation générés (2-486). Erreurs communes sans détail interne et traductions front (2-485), logger serveur de 2-490 réutilisé.

Déjà corrigé : notifications par email de la soumission (approbateur) et de la décision (soumetteur), émises dans la transaction de la note via l'outbox (2-484, `src/adapters/PgNotificationEvents.ts`, handlers dans `src/worker/notificationHandlers.ts`) ; codes **401** sans session / **403** rôle refusé sur toutes les routes (Q1.1, PR #8) ; tests unitaires (Vitest, dans `npm run check` et la CI) et règles d'architecture vérifiées par le lint (2-489) ; OCR : montant lu sur la dernière ligne de total chiffrée, « TTC » en priorité, et description suggérée (nom du commerçant), règles pures dans `src/modules/receipt-analysis/domain/parseReceiptText.ts` (PR #17) ; sécurité WS1 (2-471) : tri `?sort=` par liste blanche (S1), reçu manager limité à son équipe (S2), rattachement limité aux managers de l'entreprise (S3), `AUTH_SECRET` lu dans l'environnement (S5) ; identité (2-496) : invitations par la RH et vérification d'email du créateur, le domaine ne donne plus aucun droit (S7), rôle relu en base à chaque requête et session de 8 h d'inactivité (S9) ; isolation par la base (S4, 2-478 puis 2-481) : l'application se connecte sous `expense_app` et le worker sous `expense_worker`, soumis à la RLS, le propriétaire ne sert qu'aux migrations et au seed (`MIGRATION_DATABASE_URL`), et chaque processus refuse de démarrer en production sous un rôle superuser ou `BYPASSRLS` (tests ISO-07, ISO-10, ISO-11). Garde-fous d'exploitation (27/10) : `AUTH_SECRET` vérifié au démarrage, refus en production s'il est absent, court ou d'exemple (`src/lib/authSecret.ts`, CONF-01) ; limite de tentatives de connexion par email et par IP, 429 + `Retry-After` sur l'API d'Auth.js (`src/lib/loginThrottle.ts`, table `login_attempts` accessible seulement par fonctions `SECURITY DEFINER`, AUTH-11) ; métriques dérivées des logs `ocr.request` et `outbox.stats` (OBS-01) ; contrat d'API sans rupture vérifié par oasdiff en CI (`make api-breaking`) ; réconciliation des reçus planifiée dans `ops/cron/`.

Ne pas « corriger au passage » un de ces points dans une PR sans rapport : ouvrir un sujet dédié. Constats détaillés : [`docs/audit/`](docs/audit/) ; décisions : [`docs/adr/`](docs/adr/) ; tickets : projet Linear ARLA, jalon J4.

## Façon de travailler (pour l'IA)

1. Lire les fichiers concernés **et leurs voisins** avant de modifier, ainsi que l'`AGENTS.md` du dossier ; imiter les conventions locales.
2. Pour une nouvelle fonctionnalité : suivre la recette `.claude/skills/nouvelle-fonctionnalite/SKILL.md` ; domaine d'abord (règle + test), puis port/adapter si dépendance externe, puis route fine, puis UI.
3. Préserver le comportement observable existant (codes de réponse, formats JSON, parcours UI) sauf demande explicite ; sinon l'écrire dans la PR.
4. Écrire ou mettre à jour les tests avec le code. Un bug corrigé = un test qui échoue avant, passe après.
5. Rester dans le périmètre demandé : pas de refacto opportuniste, pas de fichiers superflus.
6. En cas de doute d'architecture, proposer plusieurs options avec leurs compromis plutôt que trancher en silence ; une décision structurante appelle une ADR.
7. Mettre à jour la doc des développeurs (`docs/index.html` et ses vues) dans le même changement que le code : « Documentation développeur » ci-dessus.
