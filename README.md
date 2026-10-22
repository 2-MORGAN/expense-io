# Expense.io

Application de gestion de notes de frais.

## Prérequis

- Node.js 24+
- Docker (Postgres, LocalStack et Mailpit en local)

## Démarrage

```bash
make dev
```

Ceci installe les dépendances, démarre Postgres, LocalStack et Mailpit,
applique les migrations, crée le bucket de stockage, peuple des comptes de
démonstration (voir "Comptes" plus bas), puis lance le serveur de développement
sur http://localhost:3000.

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

## Emails et worker

Les notifications (note soumise, note approuvée ou rejetée) passent par une
file (`outbox_events`) que traite un worker. Dans un **second terminal**, après
`make dev` :

```bash
make worker   # ou : npm run worker
```

Sans le worker, l'application fonctionne mais aucun email n'est envoyé : les
événements restent en attente et partent dès qu'il démarre.

En local, tous les emails arrivent dans **Mailpit** (SMTP sur le port 1025,
interface sur http://localhost:8025) : aucun ne sort de la machine.

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
make test-unit # tests unitaires Vitest, sans Docker
make test-e2e  # tests E2E de non-régression (voir docs/tests/E2E.md)
make verify    # ce que vérifie la CI : lint, types, tests unitaires, build puis E2E (Docker requis)
npm run check  # lint, types et tests unitaires, à lancer avant de pousser
make down    # arrête Postgres/LocalStack/Mailpit
make clean   # arrête et supprime les données locales
```
