# Prod/dev shortcuts. Prod lives in this worktree (main); dev lives in DEV_DIR (develop).
# Override DEV_DIR if your dev worktree is elsewhere:  make dev-up DEV_DIR=/path/to/inferr-dev

DEV_DIR ?= ../inferr-dev

COMPOSE_PROD := docker compose -p inferr --env-file .env -f docker-compose.yml -f docker-compose.prod.yml
COMPOSE_DEV  := docker compose -p inferr-dev --env-file .env

.PHONY: deploy prod-up prod-down prod-logs prod-ps dev-up dev-down dev-logs dev-ps

deploy:
	bash scripts/deploy-prod.sh

prod-up:
	$(COMPOSE_PROD) up -d

prod-down:
	$(COMPOSE_PROD) down

prod-logs:
	$(COMPOSE_PROD) logs -f --tail=100

prod-ps:
	$(COMPOSE_PROD) ps

dev-up:
	cd $(DEV_DIR) && $(COMPOSE_DEV) up -d

dev-down:
	cd $(DEV_DIR) && $(COMPOSE_DEV) down

dev-logs:
	cd $(DEV_DIR) && $(COMPOSE_DEV) logs -f --tail=100

dev-ps:
	cd $(DEV_DIR) && $(COMPOSE_DEV) ps
