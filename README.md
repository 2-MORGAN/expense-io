# Expense.io

Application de gestion de notes de frais.

## Prérequis

- Node.js 24+
- Docker (Postgres + LocalStack en local)

## Démarrage

```bash
make dev
```

Ceci installe les dépendances, démarre Postgres et LocalStack, applique les
migrations, crée le bucket de stockage, peuple des comptes de démonstration
(voir "Comptes" plus bas), puis lance le serveur de développement sur
http://localhost:3000.

Sans `make`, l'équivalent manuel :

```bash
npm install
cp .env.example .env
docker compose up -d
npm run migrate:up
npm run ensure-bucket
npm run seed
npm run dev
```

## Comptes

`make dev` (ou `npm run seed`) crée trois comptes de la même entreprise,
avec chacun une note de frais en attente pour les deux derniers —
relançable sans dupliquer quoi que ce soit :

| Rôle | Email | Mot de passe |
|---|---|---|
| RH | `hr@expense.io` | `hr1234` |
| Manager (racine, sans manager assigné) | `manager@expense.io` | `manager1234` |
| Employé (rattaché au manager ci-dessus) | `demo@expense.io` | `demo1234` |

Tu peux aussi créer d'autres comptes via `/signup` : le premier compte créé
sur un domaine email donné fonde une nouvelle entreprise et en devient RH ;
les comptes suivants sur le même domaine la rejoignent comme employés. Le
rôle `manager` n'est en revanche jamais assignable depuis l'interface —
seulement via le script de seed ou directement en base.

## Variables d'environnement

Voir `.env.example`.

## OCR et worker

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

## Contrat API

Les 16 opérations métier sont décrites dans [openapi.yaml](openapi.yaml).
Les types serveur/front sont générés par `npm run generate:api` ;
`npm run check` contrôle le contrat, les artefacts et la couverture des routes.
Validation des entrées, outils, compatibilité et transition des erreurs :
[docs/api/README.md](docs/api/README.md).

## Autres commandes

```bash
make build   # build de production
make start   # build puis démarre en production
make lint
make typecheck
make test-unit # tests unitaires Vitest, sans Docker
make test-e2e  # tests E2E de non-régression (voir docs/tests/E2E.md)
make verify    # ce que vérifie la CI : lint, types, tests unitaires, build puis E2E (Docker requis)
npm run check  # lint, types, tests unitaires et contrat API, lancé aussi par le hook git pre-push
make down    # arrête Postgres/LocalStack
make clean   # arrête et supprime les données locales
```
