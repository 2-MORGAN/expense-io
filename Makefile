SHELL := /bin/bash
.DEFAULT_GOAL := help

COMPOSE := docker compose

.PHONY: help install env up down restart logs migrate ensure-bucket seed worker dev build start lint typecheck clean test-unit test-e2e verify api-breaking frozen reconcile

help: ## Affiche cette aide
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-18s\033[0m %s\n", $$1, $$2}'

install: ## Installe les dépendances npm
	npm install

env: ## Crée .env depuis .env.example si absent, avec un AUTH_SECRET et des mots de passe de base aléatoires
	@if [ ! -f .env ]; then \
		cp .env.example .env; \
		node -e "const fs=require('fs'),c=require('crypto');let s=fs.readFileSync('.env','utf8');for(const p of ['expense-app-local','expense-worker-local'])s=s.split(p).join(c.randomBytes(18).toString('hex'));s=s.split('changeme-generate-a-real-secret-for-non-local-use').join(c.randomBytes(32).toString('base64url'));fs.writeFileSync('.env',s)"; \
		echo ".env créé depuis .env.example (AUTH_SECRET et mots de passe des rôles de base générés)"; \
	elif ! grep -q '^MIGRATION_DATABASE_URL=' .env; then \
		echo ".env antérieur à 2-481 : reprendre les quatre variables *DATABASE_URL de .env.example, puis npm run migrate:up." >&2; \
	fi

up: env ## Démarre Postgres + LocalStack + Mailpit (Docker) et attend qu'ils soient prêts
	$(COMPOSE) up -d
	@echo "En attente que Postgres, LocalStack et Mailpit soient opérationnels..."
	@for i in $$(seq 1 30); do \
		pg_ok=$$($(COMPOSE) ps postgres 2>/dev/null | grep -c "healthy"); \
		localstack_ok=$$($(COMPOSE) ps localstack 2>/dev/null | grep -c "healthy"); \
		mailpit_ok=$$($(COMPOSE) ps mailpit 2>/dev/null | grep -c "healthy"); \
		if [ "$$pg_ok" -ge 1 ] && [ "$$localstack_ok" -ge 1 ] && [ "$$mailpit_ok" -ge 1 ]; then echo "Postgres, LocalStack et Mailpit prêts."; exit 0; fi; \
		sleep 2; \
	done; \
	echo "Timeout en attendant Postgres/LocalStack/Mailpit — vérifie 'docker compose ps' et 'make logs'." >&2; exit 1

down: ## Arrête Postgres + LocalStack + Mailpit (conserve les données)
	$(COMPOSE) down

restart: down up ## Redémarre Postgres + LocalStack + Mailpit

logs: ## Suit les logs de Postgres + LocalStack + Mailpit
	$(COMPOSE) logs -f

migrate: ## Applique les migrations SQL (idempotent)
	npm run migrate:up

ensure-bucket: ## Crée le bucket S3 "receipts" s'il n'existe pas déjà
	npm run ensure-bucket

seed: ## Peuple une base de démonstration navigable (RH, manager, employé, notes de frais)
	npm run seed

worker: ## Lance le worker de l'outbox seul (make dev le lance déjà avec le serveur)
	npm run worker

dev: install up migrate ensure-bucket seed ## Tout lancer : install, Docker, migrations, bucket, seed, puis le serveur de dev
	npm run dev

build: ## Build de production
	npm run build

start: build ## Build puis lance le serveur de prod
	npm run start

lint: ## Lint du code
	npm run lint

typecheck: ## Vérifie les types
	npm run typecheck

test-unit: ## Tests unitaires Vitest (sans Docker)
	npm run test:unit

test-e2e: up migrate ensure-bucket ## Tests E2E Playwright (démarre Docker, migre ; lance ou réutilise le serveur de dev)
	npm run test:e2e

api-breaking: ## Contrat d'API sans rupture par rapport à origin/main (oasdiff, comme la CI)
	git fetch --no-tags --depth=1 origin main
	bash scripts/check-api-breaking.sh origin/main

frozen: ## Migrations et tests E2E déjà dans main inchangés depuis le départ de la branche (comme la CI)
	git fetch --no-tags origin main
	node scripts/check-frozen.mjs "$$(git merge-base HEAD origin/main)"

reconcile: ## Reçus orphelins sur S3 : rapport (dry-run) ; tâche quotidienne dans ops/cron/
	npm run reconcile:orphan-receipts

verify: env ## Ce que vérifie la CI : lint, types, tests unitaires, build de production, puis E2E (Docker requis)
	npm run check
	npm run build
	$(MAKE) test-e2e

clean: ## Arrête Docker et supprime les volumes — efface les données locales (Postgres/LocalStack/Mailpit)
	$(COMPOSE) down -v
