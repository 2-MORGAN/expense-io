SHELL := /bin/bash
.DEFAULT_GOAL := help

COMPOSE := docker compose

.PHONY: help install env up down restart logs migrate ensure-bucket seed dev build start lint typecheck clean

help: ## Affiche cette aide
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-18s\033[0m %s\n", $$1, $$2}'

install: ## Installe les dépendances npm
	npm install

env: ## Crée .env depuis .env.example si absent, génère AUTH_SECRET si besoin
	@if [ ! -f .env ]; then cp .env.example .env; echo ".env créé depuis .env.example"; fi

up: env ## Démarre Postgres + LocalStack (Docker) et attend qu'ils soient prêts
	$(COMPOSE) up -d
	@echo "En attente que Postgres et LocalStack soient opérationnels..."
	@for i in $$(seq 1 30); do \
		pg_ok=$$($(COMPOSE) ps postgres 2>/dev/null | grep -c "healthy"); \
		localstack_ok=$$($(COMPOSE) ps localstack 2>/dev/null | grep -c "healthy"); \
		if [ "$$pg_ok" -ge 1 ] && [ "$$localstack_ok" -ge 1 ]; then echo "Postgres + LocalStack prêts."; exit 0; fi; \
		sleep 2; \
	done; \
	echo "Timeout en attendant Postgres/LocalStack — vérifie 'docker compose ps' et 'make logs'." >&2; exit 1

down: ## Arrête Postgres + LocalStack (conserve les données)
	$(COMPOSE) down

restart: down up ## Redémarre Postgres + LocalStack

logs: ## Suit les logs de Postgres + LocalStack
	$(COMPOSE) logs -f

migrate: ## Applique les migrations SQL (idempotent)
	npm run migrate:up

ensure-bucket: ## Crée le bucket S3 "receipts" s'il n'existe pas déjà
	npm run ensure-bucket

seed: ## Peuple une base de démonstration navigable (RH, manager, employé, notes de frais)
	npm run seed

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

clean: ## Arrête Docker et supprime les volumes — efface les données locales (Postgres/LocalStack)
	$(COMPOSE) down -v
