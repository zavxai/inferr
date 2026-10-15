# AGENTS.md

This file provides guidance to AI coding agents when working with code in this repository.

## Repository Layout

- `apps/api` — NestJS REST API
- `apps/web` — Next.js 15 frontend
- `packages/types` — shared TypeScript types
- `cloudflare/` — Cloudflare Worker (handles `inferr.xyz` routing)
- Monorepo managed with pnpm workspaces + Turbo

## Development Model (Prod/Dev Isolation)

This repo is set up with **two worktrees** on the same machine:

- **`inferr/`** (prod worktree, checked out to `main`) — the live/production runtime. Code here is a mirror of `origin/main` (pulled via `scripts/deploy-prod.sh`). Do **not** edit code directly in prod.
- **`inferr-dev/`** (dev worktree, checked out to `develop`) — sandbox for development. Edit here, commit on `develop`, push, open PR to `main`, merge, then deploy to prod.

Isolation is enforced by:
- Separate Docker Compose projects: `inferr` (prod) vs `inferr-dev` (dev)
- Separate volumes: `inferr_postgres_data` vs `inferr-dev_postgres_data`
- Separate ports and env files
- Prod web is a **built** Next.js image (no live bind-mount); dev web runs `pnpm dev` with hot reload.

## Quick Commands

### Root
```bash
npm run dev          # Start all apps in parallel (Turbo)
npm run build        # Build all apps
npm run lint         # Lint all apps
npm run test         # Run all tests
```

### API (`apps/api/`)
```bash
npm run dev          # NestJS watch mode
npm run build        # Compile to dist/
npm run test         # Jest
npm run test:watch   # Jest watch mode
npm run test:e2e     # E2E tests

npm run db:generate  # Generate Drizzle migration SQL from schema changes
npm run db:migrate   # Apply pending migrations to Postgres
npm run db:seed      # Upsert test user + interests
npm run db:studio    # Open Drizzle Studio at https://local.drizzle.studio
```

### Web (`apps/web/`)
```bash
npm run dev          # Next.js dev server
npm run build        # Production build
npm run lint         # ESLint via next lint
```

## Running (Local Docker)

### Prod stack (project `inferr`)
- API: `http://localhost:3001` (public: `https://api.inferr.xyz`)
- Web: `http://localhost:4000` (public: `https://inferr.xyz`)
- Postgres: `localhost:5434` (container 5432)
- Jaeger: UI `http://localhost:16687`, gRPC 5317, HTTP 5318

Start prod with built web + prod overrides:
```bash
cd inferr
docker compose -p inferr --env-file .env -f docker-compose.yml -f docker-compose.prod.yml up -d
```

Deploy (pull + rebuild from origin/main):
```bash
cd inferr
bash scripts/deploy-prod.sh
# or: make deploy
```

### Dev stack (project `inferr-dev`)
- API: `http://localhost:3002`
- Web: `http://localhost:4001` (Next.js dev, hot reload)
- Postgres: `localhost:5435` (container 5432)
- Jaeger: UI `http://localhost:16688`, gRPC 5319, HTTP 5320

Start dev:
```bash
cd inferr-dev
docker compose -p inferr-dev --env-file .env up -d
# or from prod dir: make dev-up
```

## Makefile Shortcuts

From the prod worktree (`inferr/`):
```makefile
make deploy        # Deploy prod (pull origin/main + rebuild)
make prod-up       # Start prod stack
make prod-down     # Stop prod stack
make prod-logs     # Tail prod logs
make prod-ps       # Show prod containers
make dev-up        # Start dev stack (inferr-dev)
make dev-down      # Stop dev stack
make dev-logs      # Tail dev logs
make dev-ps       # Show dev containers
```

## Architecture

### Database
PostgreSQL 16 with **pgvector** extension. Drizzle ORM (no TypeORM/Prisma). Schema tables: `users`, `articles`, `refresh_tokens`, `mcp_tokens`, `user_interests`, `jobs`, `market_reports`, `ai_evaluations`, `mcp_clients`, `pending_mcp_authorizations`, `pending_auth_codes`, `cron_locks`.

- `articles.embedding`, `user_interests.queryEmbedding` are `vector(1536)` (OpenAI `text-embedding-3-small`).
- Vector similarity uses native `<=>` operator.
- Column names are **snake_case**.
- Drizzle config: `apps/api/drizzle.config.ts` (local uses `ssl: false`).
- Migrations in `apps/api/drizzle/`.

**Migration discipline (critical):**
- Never edit, renumber, or backdate a migration once applied anywhere. Only add **new** migrations.
- New migrations get `when = Date.now()` greater than current max.
- For prod (Neon), run migrations with `DB_SSL=true` and verify additive changes.

### NestJS Modules
`DrizzleModule`, `AuthModule`, `UsersModule`, `AiModule`, `FeedModule`, `ChatModule`, `ScraperModule`, `JobsModule`, `SchedulerModule`, `McpModule` (+ `McpAuthModule`), `EvaluationsModule`, `LangfuseModule`. DB injected via `@Inject(DRIZZLE)`; no repository layer (services query Drizzle directly).

### Auth
Web auth uses Google OAuth 2.0. API issues/validates tokens; see `auth/google.strategy.ts`. Frontend stores token in localStorage + cookie. Protected endpoints use `Authorization: Bearer <...>` with JWT guard.

### MCP (OAuth 2.1 + Google)
SSE at `/mcp` with tools: `search_articles`, `get_personalized_feed`, `ask_inferr`. JWT access (1h) + refresh (7d), rotation + reuse detection. Per-user `McpServer` instances; active transports in-memory (sticky sessions required for horizontal scaling). DB-backed clients/tokens/states.

### Scheduler
`SchedulerService` uses DB-backed distributed lock in `cron_locks` (PK `job_name`) with 6h TTL safety window to prevent concurrent runs across replicas.

### Next.js Web
`app/page.tsx` (landing), `app/auth/callback/page.tsx`, `app/dashboard/page.tsx`, `middleware.ts`. API base via `API_BASE`/env.

## Environment Variables

Single `.env` per worktree (gitignored). **Prod** worktree has `.env` for prod; **dev** has `.env` for dev.

Core keys:
- `API_URL` (prod `https://api.inferr.xyz`, dev `http://localhost:3002`)
- `FRONTEND_URL` (prod `https://inferr.xyz`, dev `http://localhost:4001`)
- `NEXT_PUBLIC_API_URL` (must equal `API_URL`; baked into web at build time)
- `API_HOST_PORT` (host port API published on: prod 3001, dev 3002)
- `API_PORT` (container listen: 3001)
- `DB_HOST_PORT` (host publish: prod 5434, dev 5435)
- `WEB_PORT` (host/web port: prod 4000, dev 4001)
- `NODE_ENV`, `JWT_SECRET`, `GOOGLE_CLIENT_ID/SECRET`, `OPENAI_API_KEY`, `SCRAPER_API_KEY`, optional `LANGFUSE_*`, `OTEL_*`

Derived: `GOOGLE_CALLBACK_URL`, `GOOGLE_MCP_CALLBACK_URL`, CORS/origin from above. Preflight: `bash scripts/preflight.sh`.

## Prod vs Dev Differences

| Aspect | Prod (`inferr/`, main) | Dev (`inferr-dev/`, develop) |
|---|---|---|
| Compose | `-f docker-compose.yml -f docker-compose.prod.yml` | `docker-compose.yml` only |
| Web | Built image (`inferr-web:prod`), `next start`, **no bind-mount** | `pnpm dev`, hot reload, bind-mounts |
| API | `NODE_ENV=production` | `NODE_ENV=development` |
| Ports | 3001/5434/4000/5317-8/16687 | 3002/5435/4001/5319-20/16688 |
| Volumes | `inferr_postgres_data`, prod web image | `inferr-dev_*` (postgres + node_modules caches) |
| Deploy | `scripts/deploy-prod.sh` pulls `origin/main` (hard reset) | manual (edit on develop) |

## Deployment Flow

1. Edit in `inferr-dev/` (develop branch).
2. Commit on `develop`, push to GitHub.
3. Open PR `develop` → `main`, merge (CI may run).
4. On prod worktree (`inferr/`): run `bash scripts/deploy-prod.sh` (or `make deploy`). This fetches `origin/main`, hard-resets, builds (api + prod web), and restarts.
5. Never push directly to prod; prod is a read-only mirror of GitHub `main`.

## Database State (Current)

- Prod DB (local `inferr_postgres_data`, port 5434): restored from Neon snapshot — 5 users, 974 articles (553 with embeddings), 139 refresh tokens, 5 user_interests. A pre-restore dump is saved under `/tmp/opencode/`.
- Dev DB (`inferr-dev_postgres_data`, port 5435): same restored snapshot (for safe testing).
- Migrations: schema present; drift history exists but is safe (use new migrations only).

## Important Notes

- Live site: `inferr.xyz` is served by Vercel (web), API by `api.inferr.xyz` → local tunnel → prod API (3001). Local `inferr-web-1` (4000) is not the public site.
- Single source of truth for URLs/ports is `.env` (per worktree). Compose interpolates from `.env`; API container also reads `.env` via `env_file`.
- Tunnel target must be `http://localhost:${API_HOST_PORT}` (prod 3001). Verify with `bash scripts/preflight.sh`.
- Google OAuth redirect URIs must include the prod callback URLs registered in Google Cloud Console.
- When editing files, follow existing conventions; never commit secrets; prefer reading existing context first.
- Keep responses concise; DO NOT add unnecessary comments unless asked.
