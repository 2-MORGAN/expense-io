# Expense.io

[![CI](https://github.com/2-MORGAN/expense-io/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/2-MORGAN/expense-io/actions/workflows/ci.yml?query=branch%3Amain)

Application de notes de frais pour plusieurs entreprises : un employé soumet
une note avec son reçu, son manager l'approuve ou la rejette, et la RH tranche
celles des managers qui n'ont pas de manager. Projet du cours ARLA (EPITA SIGL) :
audit d'architecture puis refacto, sans casser le comportement existant.

Ce README suffit pour lancer, vérifier et modifier le projet. Les règles
détaillées, communes aux humains et aux IA, sont dans [`AGENTS.md`](AGENTS.md).
Pour comprendre l'architecture, les services, les parcours et les ADR en
schémas : la doc des développeurs, [`docs/index.html`](docs/index.html), à
ouvrir dans un navigateur.

## Démarrer

### Prérequis

| Outil | Version | Remarque |
|---|---|---|
| Node.js et npm | 24 (`.nvmrc`) | |
| Docker, avec Compose v2 | Docker Desktop ou Docker Engine | lance PostgreSQL 16, LocalStack (S3) et Mailpit |
| `make` et `bash` | | fournis sous macOS et Linux. Sous Windows : WSL, ou les commandes sans `make` ci-dessous |

Ports utilisés : 3000 (application), 5433 (PostgreSQL), 4567 (S3), 1025 et 8025
(Mailpit) ; en option, 3001 (Grafana) et 4318 (OpenTelemetry) avec
[l'observabilité](#observabilité--grafana), 3002 (Umami) avec
[la mesure d'usage](#mesure-dusage--umami). Si l'un est déjà pris, voir [Dépannage](#dépannage).

### Lancer

```bash
make dev
```

`make dev` installe les dépendances, crée `.env` depuis `.env.example` s'il
n'existe pas, démarre les conteneurs, applique les migrations, crée le bucket
des reçus et les comptes de démonstration, puis lance l'application sur
http://localhost:3000, avec le worker. La commande se relance sans rien
dupliquer.

Sans `make` (PowerShell ou Git Bash), l'équivalent :

```bash
npm install
cp .env.example .env          # seulement si .env n'existe pas encore
docker compose up -d --wait   # attend que les conteneurs soient prêts
npm run migrate:up
npm run ensure-bucket
npm run seed
npm run dev
```

### Comptes de démonstration

Trois comptes de la même entreprise ; le manager et l'employé ont chacun une
note de frais en attente :

| Rôle | Email | Mot de passe |
|---|---|---|
| RH | `hr@expense.io` | `hr1234` |
| Manager (racine, sans manager assigné) | `manager@expense.io` | `manager1234` |
| Employé (rattaché au manager ci-dessus) | `demo@expense.io` | `demo1234` |

D'autres comptes se créent sur `/signup`. Le domaine de l'email ne donne
aucun droit (faille S7 corrigée par 2-496, ADR-001 §3) : s'inscrire sans
invitation crée sa propre entreprise, dont on devient RH après avoir confirmé
son email par le lien reçu. Pour rejoindre une entreprise, sa RH envoie une
invitation depuis `/hr` ; le lien, à usage unique et valable 7 jours, vaut
vérification d'email. En local, les emails arrivent dans Mailpit
(http://localhost:8025). Le rôle `manager` ne s'attribue que par le seed ou en
base.

### OCR, emails et worker

`npm run dev` démarre Next.js et le worker d'outbox ensemble. En production,
lancer `npm run start` et `npm run worker` comme deux processus supervisés.
Les migrations et le bucket doivent être prêts avant leur démarrage.

Le bouton de préremplissage lance une analyse puis consulte son résultat.
Il propose le montant (ligne « TTC » ou « à payer » en priorité), la date et
une description : le nom du commerçant lu en tête du reçu, placé seulement si
le champ est vide. Les PDF ne sont pas analysés.
L'ancienne route synchrone reste disponible. Les protections, le contrat
de la file commune avec les notifications et les choix de reprise sont
décrits dans [docs/ocr.md](docs/ocr.md).

En local, les emails arrivent dans Mailpit (http://localhost:8025) : aucun ne
sort de la machine.

### Variables d'environnement

[`.env.example`](.env.example) fait foi ; `make dev` le copie en `.env` et y
génère `AUTH_SECRET` et les mots de passe des rôles de base. En production, le
serveur refuse de démarrer si `AUTH_SECRET` est absent, fait moins de 32
caractères ou vaut la valeur d'exemple (CONF-01). Rotation du secret : le
remplacer et redémarrer ; toutes les sessions sont invalidées. Chaque processus a son rôle
PostgreSQL (2-481) : l'application `expense_app` (`DATABASE_URL`), le worker
`expense_worker` (`WORKER_DATABASE_URL`), les migrations et le seed le
propriétaire (`MIGRATION_DATABASE_URL`). `npm run migrate:up` pose sur la base
les mots de passe lus dans `.env` : rien à échanger entre postes.

## Vérifier

| Commande | Ce qu'elle vérifie | Docker |
|---|---|---|
| `npm run check` | lint (règles d'architecture et de SonarQube comprises, promesses oubliées par `npm run lint:promises`), types (scripts `.mjs` en `// @ts-check` compris), tests unitaires, contrat API valide et types générés à jour, graphes des couches et des routes à jour ([`docs/architecture/`](docs/architecture/README.md)), doc des développeurs à jour de ses schémas ([`docs/index.html`](docs/index.html)) | non |
| `npx playwright test -g "<ID>"` | un scénario E2E désigné par son ID ([`docs/tests/E2E.md`](docs/tests/E2E.md)), sur le serveur de `make dev` s'il tourne | oui |
| `make test-e2e` | toute la suite E2E de non-régression, environ 3 min | oui |
| `make verify` | tout ce que vérifie la CI : `npm run check`, build de production, puis la suite E2E | oui |
| `npm run test:coverage` | couverture des tests unitaires (domaine, cas d'usage, `src/http`, `src/lib`), rapport dans `coverage/index.html` ; `npm run test:coverage:ui` pour l'interface Vitest | non |
| `npm run test:e2e:coverage` | couverture de la suite E2E : serveur Next.js, worker et scripts, rapport dans `coverage-e2e-report/index.html`. Démarre son propre serveur : arrêter `make dev` avant. Arguments passés à Playwright : `npm run test:e2e:coverage -- -g "NDF-"` | oui |

Avant le premier test E2E, installer le navigateur : `npx playwright install chromium`
(sous Linux : `npx playwright install --with-deps chromium`). Sans `make`, les
étapes sont dans [`docs/tests/E2E.md`](docs/tests/E2E.md#commande).

Ce qui tourne sans qu'on le demande ([ADR-005](docs/adr/ADR-005-harnais-de-validation.md)) :

| Quand | Quoi |
|---|---|
| `git commit` | ESLint (hook pre-commit) |
| `git push` | `npm run check` (hook pre-push) |
| PR vers `main`, push sur `main` | CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) : `check` (lint, types, tests unitaires, contrat d'API sans rupture avec oasdiff sur les PR, build) et `e2e` (`make test-e2e`), obligatoires pour fusionner |
| Avec Claude Code | les hooks de [`.claude/settings.json`](.claude/settings.json) refusent `--no-verify`, le push sur `main`, le force-push et `eslint --suppress-all`, et lancent `npm run check` en fin de tour si du code a changé |

Les hooks git s'installent avec `npm install`.

### Journaux

Le code du serveur et le worker écrivent une ligne JSON par événement (`time`,
`level`, `msg`, puis le contexte). Une erreur serveur y figure avec son message
et sa pile (`"msg":"http.error"` ou `"request.error"`), sans email ni URL
pré-signée (ADR-005 §5) ; Next.js affiche en plus, en texte, les erreurs qu'il
capte. La sortie du serveur s'affiche dans le terminal de `make dev`, ou dans la
console de Playwright quand il démarre lui-même le serveur ; en CI, dans le
journal du job `e2e`.

Métriques, dérivées de ces lignes par le collecteur de logs (ADR-003 §6) :

| Ligne | Métrique | Qui l'écrit |
|---|---|---|
| `"msg":"ocr.request"` | `ocr_requests_total{outcome}` : `found`, `empty`, `rejected`, `failed`, `timeout`, `overloaded`, avec `durationMs` et `requestId` | le serveur, à chaque suggestion OCR |
| `"msg":"outbox.stats"` | événements `pending` et `dead` (DLQ), âge du plus ancien en attente (`oldestPendingAgeSeconds`), au total et par type | le worker, toutes les minutes (`OUTBOX_STATS_INTERVAL_MS`) |

Une réponse d'erreur porte son `requestId` (corps et en-tête `X-Request-Id`),
repris dans la ligne `http.error` du journal.

### Observabilité : Grafana

En option, le serveur et le worker envoient leurs traces, métriques et journaux
(OpenTelemetry) à Grafana, avec un tableau de bord et des alertes prêts
([ADR-007](docs/adr/ADR-007-observabilite.md), acceptée) :

```bash
make observability   # sans make : docker compose -f docker-compose.observability.yml up -d --wait
```

Puis, dans `.env`, décommenter `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318`
et relancer `make dev`. Grafana : http://localhost:3001. Loki y sert de
collecteur pour les lignes ci-dessus (`ocr.request`, `outbox.stats`), et les
alertes arrivent dans Mailpit. Sans cette variable, rien n'est envoyé : c'est le
cas par défaut, en CI et pendant les E2E. Mesures, alertes et ajout d'une
métrique : [`docs/observability.md`](docs/observability.md).

### Mesure d'usage : Umami

En option, le navigateur envoie à Umami les pages vues et trois événements
(note commencée, note envoyée avec le sort de la suggestion OCR, invitation
envoyée), pour savoir comment le produit est utilisé
([ADR-008](docs/adr/ADR-008-mesure-usage-umami.md), acceptée) :

```bash
make analytics   # sans make : docker compose -f docker-compose.analytics.yml up -d --wait, puis npm run analytics:setup
```

Puis copier dans `.env` les deux lignes affichées (`UMAMI_SCRIPT_URL`,
`UMAMI_WEBSITE_ID`) et relancer `make dev`. Umami : http://localhost:3002,
compte `admin` / `umami`. Sans ces variables, aucune page ne charge le script :
c'est le cas par défaut, en CI et pendant les E2E. Sans cookie ni identifiant,
et sans chaîne de requête dans les URL envoyées. En option, `UMAMI_HEATMAP=true`
ajoute la heatmap (clics et défilement) et les replays, tout texte masqué, de
`/expenses`, `/manager` et `/hr`.
Entonnoirs et objectifs sont créés par `npm run analytics:setup`, et
`npm run analytics:demo -- --execute` les remplit avec des parcours de
démonstration, joués dans l'application lancée par `make dev`. Questions,
rapports et ajout d'un événement : [`docs/analytics.md`](docs/analytics.md).

### Tâches planifiées

La réconciliation quotidienne des reçus orphelins sur S3 est décrite dans
[`ops/cron/expense-io.crontab`](ops/cron/expense-io.crontab), à installer sur
l'hôte ou le planificateur de l'hébergeur après un premier `make reconcile`
(dry-run) relu.

## Contrat API

Les 16 opérations métier sont décrites dans [openapi.yaml](openapi.yaml).
Les types serveur/front sont générés par `npm run generate:api` ;
`npm run check` contrôle le contrat, les artefacts et la couverture des routes.
Validation des entrées, outils, compatibilité et transition des erreurs :
[docs/api/README.md](docs/api/README.md).

## Contribuer

1. Lire [`AGENTS.md`](AGENTS.md). Seules les ADR au statut « Acceptée » font foi ([`docs/adr/`](docs/adr/README.md)).
2. Partir de `main` à jour (`git pull`, puis `npm install` si `package.json` a changé). Une branche par changement, nommée avec le ticket Linear : `fix/2-471-correctifs-securite`, ou le nom que propose Linear.
3. Commits conventionnels, comme l'historique : `feat(ocr): …`, `fix(api): …`, `test(e2e): …`, `docs(adr): …`, `chore: …`.
4. Un bug corrigé = un test vu en échec avant la correction, en succès après.
   La doc des développeurs ([`docs/index.html`](docs/index.html)) se met à jour
   dans la même PR que le code (`AGENTS.md`, « Documentation développeur »).
5. Récupérer `main` d'abord : `git fetch`, et si elle a avancé, `git merge origin/main` dans la branche (pas de rebase d'une branche poussée), puis `npm run check`. Ouvrir ensuite la PR avec `gh pr create --repo 2-MORGAN/expense-io --base main` (sans `--repo`, `gh` peut viser le dépôt du cours) et remplir le modèle.
6. Fusion par squash, une fois `check` et `e2e` verts et la PR relue par un pair. `main` refuse le push direct et le force-push.
7. Un test E2E ne change que si une ADR acceptée décide le changement de comportement, et dans un commit séparé ([ADR-005 §2](docs/adr/ADR-005-harnais-de-validation.md#2-régression-ou-changement-voulu)).
8. Une décision d'architecture s'écrit dans une ADR, à partir du [modèle](docs/adr/ADR-000-modele.md).

## Carte du dépôt

| Chemin | Contenu |
|---|---|
| [`AGENTS.md`](AGENTS.md) | règles d'architecture, de sécurité et de vérification, lues par tous les assistants IA ; [`CLAUDE.md`](CLAUDE.md) l'importe pour Claude Code |
| [`docs/index.html`](docs/index.html) | doc des développeurs : services, architecture du code, parcours, données, API, choix d'architecture et ADR, en schémas ; à ouvrir dans un navigateur |
| [`docs/adr/`](docs/adr/README.md) | décisions d'architecture, leur statut et le modèle |
| [`docs/audit/`](docs/audit/) | constats d'audit : sécurité (S), architecture (A), API (Q, B) |
| [`docs/tests/E2E.md`](docs/tests/E2E.md) | scénarios E2E avec leurs IDs, résultats des exécutions |
| [`openapi.yaml`](openapi.yaml), [`docs/api/`](docs/api/README.md) | contrat de l'API (16 opérations) et ses règles d'évolution |
| [`docs/ocr.md`](docs/ocr.md) | OCR : protections et file asynchrone |
| [`docs/observability.md`](docs/observability.md), [`observability/`](observability/) | observabilité optionnelle : guide, puis tableau de bord, alertes et configuration de la pile Grafana (`docker-compose.observability.yml`) |
| [`docs/analytics.md`](docs/analytics.md) | mesure d'usage optionnelle : questions, événements, rapports d'Umami (`docker-compose.analytics.yml`) |
| [`docs/architecture/`](docs/architecture/README.md) | graphes Mermaid des couches et des routes, générés depuis le code (`npm run generate:architecture`) et vérifiés par `npm run check` ; vues écrites à la main (`vues/`) de la doc des développeurs |
| `src/` | le code ; où placer quoi : « Où placer le code » dans `AGENTS.md` |
| `migrations/` | schéma SQL versionné, seule source de vérité |
| `e2e/` | tests Playwright |
| `scripts/` | seed, bucket, lancement du serveur et du worker, moteur OCR, générateur des graphes d'architecture |
| `.github/` | CI et modèle de PR |
| `.claude/` | hooks Claude Code |

## Autres commandes

```bash
make help      # toutes les cibles du Makefile
make build     # build de production
make start     # build puis démarre en production
make worker    # le worker seul (make dev le lance déjà)
make api-breaking  # contrat d'API sans rupture par rapport à main (oasdiff)
make frozen    # migrations et tests E2E déjà dans main inchangés (comme la CI)
make reconcile # reçus orphelins sur S3, rapport seul (dry-run)
make logs      # journaux des conteneurs
make down      # arrête les conteneurs, garde les données
make clean     # arrête les conteneurs et supprime les données locales
make observability       # Grafana : traces, métriques et journaux (http://localhost:3001)
make observability-down  # arrête Grafana, garde ses données
make analytics           # Umami : mesure d'usage (http://localhost:3002), affiche les variables de .env
make analytics-down      # arrête Umami, garde ses données
npm run analytics:demo -- --execute  # parcours de démonstration qui remplissent les rapports d'Umami
```

## Dépannage

| Symptôme | Cause et solution |
|---|---|
| `npm run migrate:up` : erreur d'authentification de l'utilisateur `expense` (code `28P01`) | Un autre PostgreSQL occupe le port 5433 (`netstat -ano \| findstr :5433` sous Windows). L'arrêter, ou exposer le conteneur sur un autre port et y faire pointer les variables `*DATABASE_URL` |
| Avertissement `db.role.bypasses_rls` au démarrage, ou `MIGRATION_DATABASE_URL absent` | `.env` antérieur à 2-481 : reprendre les quatre variables `*DATABASE_URL` de `.env.example`, puis `npm run migrate:up` |
| `npm run check` échoue juste après un pull | Une dépendance a changé : `npm install` |
| Lint : erreur `sonarjs/…` | Règle de SonarQube : corriger le code. Les constats du code existant sont figés dans `eslint-suppressions.json`, qui ne fait que raccourcir ([`AGENTS.md`](AGENTS.md), « Où placer le code ») |
| Lint : « There are suppressions left that do not occur anymore » | Un constat figé a été corrigé : `npx eslint --prune-suppressions`, puis commiter `eslint-suppressions.json` avec la correction |
| `npm run check` : « docs/architecture/… a dérivé du code » | Un import entre couches ou une route a changé : `npm run generate:architecture`, relire le diff, le commiter avec le code. Une flèche interdite ou une route sans garde se corrigent dans le code ([`docs/architecture/`](docs/architecture/README.md)) |
| `npm run check` : « docs/index.html … », « ADR sans fiche », « table absente », « type d'événement » | La doc des développeurs n'a pas suivi le code : `npm run generate:architecture` recopie les schémas ; une ADR, une table ou un événement se décrivent à la main (`AGENTS.md`, « Documentation développeur ») |
| Sous Windows, `npm run check` signale des types générés « not up-to-date » sans modification | Fichier extrait en fins de ligne CRLF avant l'ajout de `.gitattributes` : le supprimer, puis `git checkout -- <fichier>` |
| Test E2E : « Executable doesn't exist » | Navigateur absent : `npx playwright install chromium` |
| Réponse 500 | Lire la ligne `"level":"error"` du journal du serveur ([Journaux](#journaux)) |
