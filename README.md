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

## Autres commandes

```bash
make build   # build de production
make start   # build puis démarre en production
make lint
make typecheck
make down    # arrête Postgres/LocalStack
make clean   # arrête et supprime les données locales
```
