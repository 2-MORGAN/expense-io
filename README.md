# Expense.io

[![CI](https://github.com/2-MORGAN/expense-io/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/2-MORGAN/expense-io/actions/workflows/ci.yml?query=branch%3Amain)

Application de notes de frais pour plusieurs entreprises : un employé soumet
une note avec son reçu, son manager l'approuve ou la rejette, et la RH tranche
celles des managers qui n'ont pas de manager. Projet du cours ARLA (EPITA SIGL) :
audit d'architecture puis refacto, sans casser le comportement existant.

Ce README suffit pour lancer, vérifier et modifier le projet. Les règles
détaillées, communes aux humains et aux IA, sont dans [`CLAUDE.md`](CLAUDE.md).

## Démarrer

### Prérequis

| Outil | Version | Remarque |
|---|---|---|
| Node.js et npm | 24 (`.nvmrc`) | |
| Docker, avec Compose v2 | Docker Desktop ou Docker Engine | lance PostgreSQL 16, LocalStack (S3) et Mailpit |
| `make` et `bash` | | fournis sous macOS et Linux. Sous Windows : WSL, ou les commandes sans `make` ci-dessous |

Ports utilisés : 3000 (application), 5433 (PostgreSQL), 4567 (S3), 1025 et 8025
(Mailpit). Si l'un est déjà pris, voir [Dépannage](#dépannage).

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

[`.env.example`](.env.example) fait foi ; `make dev` le copie en `.env`.

## Vérifier

| Commande | Ce qu'elle vérifie | Docker |
|---|---|---|
| `npm run check` | lint (règles d'architecture et de SonarQube comprises), types, tests unitaires, contrat API valide et types générés à jour, graphes des couches et des routes à jour ([`docs/architecture/`](docs/architecture/README.md)) | non |
| `npx playwright test -g "<ID>"` | un scénario E2E désigné par son ID ([`docs/tests/E2E.md`](docs/tests/E2E.md)), sur le serveur de `make dev` s'il tourne | oui |
| `make test-e2e` | toute la suite E2E de non-régression, environ 3 min | oui |
| `make verify` | tout ce que vérifie la CI : `npm run check`, build de production, puis la suite E2E | oui |

Avant le premier test E2E, installer le navigateur : `npx playwright install chromium`
(sous Linux : `npx playwright install --with-deps chromium`). Sans `make`, les
étapes sont dans [`docs/tests/E2E.md`](docs/tests/E2E.md#commande).

Ce qui tourne sans qu'on le demande ([ADR-005](docs/adr/ADR-005-harnais-de-validation.md)) :

| Quand | Quoi |
|---|---|
| `git commit` | ESLint (hook pre-commit) |
| `git push` | `npm run check` (hook pre-push) |
| PR vers `main`, push sur `main` | CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) : `check` (lint, types, tests unitaires, build) et `e2e` (`make test-e2e`), obligatoires pour fusionner |
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

## Contrat API

Les 16 opérations métier sont décrites dans [openapi.yaml](openapi.yaml).
Les types serveur/front sont générés par `npm run generate:api` ;
`npm run check` contrôle le contrat, les artefacts et la couverture des routes.
Validation des entrées, outils, compatibilité et transition des erreurs :
[docs/api/README.md](docs/api/README.md).

## Contribuer

1. Lire [`CLAUDE.md`](CLAUDE.md). Seules les ADR au statut « Acceptée » font foi ([`docs/adr/`](docs/adr/README.md)).
2. Partir de `main` à jour (`git pull`, puis `npm install` si `package.json` a changé). Une branche par changement, nommée avec le ticket Linear : `fix/2-471-correctifs-securite`, ou le nom que propose Linear.
3. Commits conventionnels, comme l'historique : `feat(ocr): …`, `fix(api): …`, `test(e2e): …`, `docs(adr): …`, `chore: …`.
4. Un bug corrigé = un test vu en échec avant la correction, en succès après.
5. Ouvrir la PR avec `gh pr create --repo 2-MORGAN/expense-io --base main` (sans `--repo`, `gh` peut viser le dépôt du cours) et remplir le modèle.
6. Fusion par squash, une fois `check` et `e2e` verts et la PR relue par un pair. `main` refuse le push direct et le force-push.
7. Un test E2E ne change que si une ADR acceptée décide le changement de comportement, et dans un commit séparé ([ADR-005 §2](docs/adr/ADR-005-harnais-de-validation.md#2-régression-ou-changement-voulu)).
8. Une décision d'architecture s'écrit dans une ADR, à partir du [modèle](docs/adr/ADR-000-modele.md).

## Carte du dépôt

| Chemin | Contenu |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | règles d'architecture, de sécurité et de vérification ; [`AGENTS.md`](AGENTS.md) y renvoie les autres assistants IA |
| [`docs/adr/`](docs/adr/README.md) | décisions d'architecture, leur statut et le modèle |
| [`docs/audit/`](docs/audit/) | constats d'audit : sécurité (S), architecture (A), API (Q, B) |
| [`docs/tests/E2E.md`](docs/tests/E2E.md) | scénarios E2E avec leurs IDs, résultats des exécutions |
| [`openapi.yaml`](openapi.yaml), [`docs/api/`](docs/api/README.md) | contrat de l'API (16 opérations) et ses règles d'évolution |
| [`docs/ocr.md`](docs/ocr.md) | OCR : protections et file asynchrone |
| [`docs/architecture/`](docs/architecture/README.md) | graphes Mermaid des couches et des routes, générés depuis le code (`npm run generate:architecture`) et vérifiés par `npm run check` |
| `src/` | le code ; où placer quoi : « Où placer le code » dans `CLAUDE.md` |
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
make logs      # journaux des conteneurs
make down      # arrête les conteneurs, garde les données
make clean     # arrête les conteneurs et supprime les données locales
```

## Dépannage

| Symptôme | Cause et solution |
|---|---|
| `npm run migrate:up` : erreur d'authentification de l'utilisateur `expense` (code `28P01`) | Un autre PostgreSQL occupe le port 5433 (`netstat -ano \| findstr :5433` sous Windows). L'arrêter, ou exposer le conteneur sur un autre port et y faire pointer `DATABASE_URL` |
| `npm run check` échoue juste après un pull | Une dépendance a changé : `npm install` |
| Lint : erreur `sonarjs/…` | Règle de SonarQube : corriger le code. Les constats du code existant sont figés dans `eslint-suppressions.json`, qui ne fait que raccourcir ([`CLAUDE.md`](CLAUDE.md), « Où placer le code ») |
| Lint : « There are suppressions left that do not occur anymore » | Un constat figé a été corrigé : `npx eslint --prune-suppressions`, puis commiter `eslint-suppressions.json` avec la correction |
| `npm run check` : « docs/architecture/… a dérivé du code » | Un import entre couches ou une route a changé : `npm run generate:architecture`, relire le diff, le commiter avec le code. Une flèche interdite ou une route sans garde se corrigent dans le code ([`docs/architecture/`](docs/architecture/README.md)) |
| Sous Windows, `npm run check` signale des types générés « not up-to-date » sans modification | Fichier extrait en fins de ligne CRLF avant l'ajout de `.gitattributes` : le supprimer, puis `git checkout -- <fichier>` |
| Test E2E : « Executable doesn't exist » | Navigateur absent : `npx playwright install chromium` |
| Réponse 500 | Lire la ligne `"level":"error"` du journal du serveur ([Journaux](#journaux)) |
