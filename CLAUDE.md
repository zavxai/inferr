# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Root (runs across all apps via Turbo)
```bash
npm run dev          # Start all apps in parallel
npm run build        # Build all apps
npm run lint         # Lint all apps
npm run test         # Run all tests
```

### API (`apps/api/`)
```bash
npm run dev          # NestJS watch mode (port 3001)
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
npm run dev          # Next.js dev server (port 3000)
npm run build        # Production build
npm run lint         # ESLint via next lint
```

### Infrastructure
```bash
docker compose up -d    # Start Postgres (5433) + Redis (6380)
docker compose ps       # Verify healthy
```

## Architecture

### Monorepo layout
- `apps/api` — NestJS REST API, port 3001
- `apps/web` — Next.js 15 frontend, port 3000
- `packages/types` — shared TypeScript types (minimal usage currently)
- Turbo orchestrates tasks; pnpm workspaces link packages

### Database
PostgreSQL with **pgvector** extension via `pgvector/pgvector:pg16` Docker image. Drizzle ORM is used throughout — no TypeORM, no Prisma.

**Schema tables:** `users`, `articles`, `refresh_tokens`, `mcp_tokens`, `user_interests`, `jobs`, `market_reports`, `ai_evaluations`, `mcp_clients`, `pending_mcp_authorizations`, `pending_auth_codes`, `cron_locks`

The `articles.embedding` and `user_interests.queryEmbedding` columns are `vector(1536)` (OpenAI `text-embedding-3-small`). Vector similarity search uses the native `<=>` operator via raw SQL.

**Column naming:** The Drizzle schema uses snake_case column names (e.g. `google_id`, `created_at`). Keep all new columns snake_case.

**Drizzle config** lives at `apps/api/drizzle.config.ts` with `ssl: false` for local Docker Postgres. Migration files output to `apps/api/drizzle/`.

#### Migration discipline (IMPORTANT)

**Never edit, renumber, or backdate a migration once it has been applied anywhere (local, CI, or prod). Only ever add a NEW migration.** If a migration is wrong, fix it forward with a new one.

Why this matters here: production and local already have **drifted migration history** because earlier migrations were edited after the fact (e.g. `0006` was rewritten to add `DROP TABLE IF EXISTS`, `0003`/`0007` were backdated, `0007_jobs_table` was renumbered when merged from another branch). Each database froze a different snapshot, so neither `__drizzle_migrations` log perfectly matches the repo journal. This is currently **cosmetic and safe** — `drizzle-kit migrate` decides what to apply by the journal `when` *timestamp*, not by hash, and all real tables/data are correct. Editing applied migrations is what caused the drift; keep doing it and you risk "table already exists" failures or silently-skipped migrations.

Rules of thumb:
- Schema change → `npm run db:generate` (creates a new file), then `npm run db:migrate`. Don't hand-edit generated SQL for already-applied versions.
- New migrations always get a `when = Date.now()` greater than the current max, so they apply cleanly to both drifted databases.
- For prod (Neon), run migrations against `DATABASE_URL` pointed at Neon with `DB_SSL=true`. Verify the target and that the change is additive before applying.

### NestJS API modules

| Module | Responsibility |
|---|---|
| `DrizzleModule` | Global database module, provides the `DRIZZLE` provider injection symbol |
| `AuthModule` | Google OAuth 2.0, token generation/rotation, session handling & guards |
| `UsersModule` | User preference persistence & account deletion cascades |
| `AiModule` | Integrates OpenAI SDK to generate summaries and vector embeddings |
| `FeedModule` | Fetches and ranks articles using cosine similarity vectors + tag boosts |
| `ChatModule` | LangGraph agentic RAG pipeline (retrieve -> grade -> rewrite -> generate) |
| `ScraperModule` | Pulls raw developer articles from Hacker News, Dev.to, and Cheerio |
| `JobsModule` | Remotive job board scraper and market report generator |
| `SchedulerModule` | Runs daily automated cron pipelines under a database-backed distributed lock |
| `McpModule` | SSE listener exposing `search_articles`, `get_personalized_feed`, and `ask_inferr` tools |
| `McpAuthModule` | Sub-module of `McpModule` providing custom OAuth 2.1 authorization & tokens |
| `EvaluationsModule` | Internal LLM-as-judge service for RAG response quality metrics |
| `LangfuseModule` | Integrates callback handlers for prompt tracing & pipeline telemetry |

**DB injection pattern** — every service that needs the DB injects it the same way:
```typescript
constructor(@Inject(DRIZZLE) private db: DrizzleDB) {}
```

**No repository layer** — services query Drizzle directly. This is intentional and consistent across all modules.

### Auth flow
1. Browser → `GET /auth/google` → Google consent screen
2. Google → `GET /auth/google/callback` → upserts user in DB → redirects to `${FRONTEND_URL}/auth/callback?token=<user.id>`
3. Frontend stores `user.id` UUID as the auth token in `localStorage` + `google_id_token` cookie
4. Protected API calls send `Authorization: Bearer <user.id>`; `GoogleTokenGuard` validates by DB lookup (no JWT)

### MCP auth flow (OAuth 2.1 + Google)
1. MCP client (Claude Desktop / Claude Code) registers at `POST /register` → gets a `client_id`
2. Client opens `GET /authorize` (PKCE) → `McpOAuthProvider` redirects to `GET /auth/google/mcp?state=…`
3. `GoogleMcpStrategy` (separate from the web-app strategy) carries the MCP `state` through Google consent
4. Google → `GET /auth/google/mcp-callback` → upserts user → `completeMcpAuthorization()` issues a single-use auth code
5. Client exchanges code for tokens at `POST /token` (PKCE verified) → receives a 1h JWT access token + 7d refresh token
6. MCP requests hit `POST /GET /DELETE /mcp` with `Authorization: Bearer <jwt>`; `McpOAuthProvider.verifyAccessToken()` validates and extracts `userId`
7. Each session gets a per-user `McpServer` instance — tools close over `userId` so one user cannot read another's feed

**MCP tools exposed:**

| Tool | Description |
|---|---|
| `search_articles` | pgvector semantic search over the article corpus |
| `get_personalized_feed` | Returns the authenticated user's personalised feed |
| `ask_inferr` | Agentic RAG pipeline (retrieve → grade → rewrite → generate) |

**Security notes:** Refresh tokens are rotated on every use and stored SHA-256-hashed in `mcp_tokens`. Reuse of an already-rotated token nukes the entire chain for that user. MCP JWTs carry `type: 'mcp_access'` to prevent cross-use with web-app tokens.

**Single-instance caveat:** Active MCP SSE session transports are stored in-memory (in `McpService`'s `transports` Map), meaning horizontal scaling requires sticky sessions at the load balancer/gateway level so that subsequent requests with a given session ID route to the container holding that socket. Registered OAuth clients, tokens, and pending PKCE authorization states are fully database-backed and cluster-safe.

### Scheduler & Locking
NestJS internal cron tasks are scheduled via `@nestjs/schedule` decorators in `SchedulerService`. To prevent concurrent execution across multiple running API replicas (e.g., inside Kubernetes pods), executions are wrapped in `runWithLock(jobName, ttl, callback)`:
- Uses the `cron_locks` table (primary key `job_name`).
- Acquires the lock by attempting to insert a row; unique constraint violation indicates the lock is currently active on another instance, causing the execution to be skipped.
- Expired locks (older than a 6-hour TTL safety window) are cleaned up automatically before attempting acquisition.
- Releases the lock on callback completion or failure via a `finally` block.

### Next.js web app
- `app/page.tsx` — public landing page; Sign In links to `${NEXT_PUBLIC_API_URL}/auth/google`
- `app/auth/callback/page.tsx` — receives `?token=` from API redirect, stores token, redirects to `/dashboard`
- `app/dashboard/page.tsx` — fetches `/auth/me` with Bearer token; redirects to `/` if unauthenticated
- `middleware.ts` — blocks `/dashboard` if `google_id_token` cookie is absent
- `src/lib/server-status.tsx` — thin wrapper: exports `API_BASE` constant and `apiFetch` (plain `fetch` pass-through). The former wake overlay and `ServerStatusProvider` have been removed.

### Environment variables
Single `.env` at the repo root, loaded by both apps. **`.env` is gitignored — it never travels with git, so every machine has its own copy.** That is why ports used to drift: the same number lived in many files and none was authoritative.

**Single source of truth.** Set these and let everything else be derived (see `apps/api/src/config/public-urls.ts`):

```
API_URL=http://localhost:3001        # public base URL of the API; prod: https://api.inferr.xyz
FRONTEND_URL=http://localhost:4000   # public base URL of the web; prod: https://inferr.xyz
NEXT_PUBLIC_API_URL=http://localhost:3001   # what the browser calls; MUST equal API_URL
API_HOST_PORT=3001                   # host port the API is published on; MUST equal the tunnel target (prod)
```

Derived automatically (only set to override):
- `GOOGLE_CALLBACK_URL` → `${API_URL}/auth/google/callback`
- `GOOGLE_MCP_CALLBACK_URL` → `${API_URL}/auth/google/mcp-callback`
- MCP issuer + `WWW-Authenticate` → `API_URL`
- CORS origin → `FRONTEND_URL`

Other keys: `API_PORT` (container listen, 3001), `DB_HOST_PORT` (host publish, 5434; container is always `5432`), `WEB_PORT` (4000), `OPENAI_API_KEY`, `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, `JWT_SECRET`, `SCRAPER_API_KEY`, optional `LANGFUSE_*`/`OTEL_*`.

The production chain that must line up — `cloudflared tunnel → localhost:${API_HOST_PORT}` == `docker publishes ${API_HOST_PORT}:${API_PORT}` == `API_URL` == `NEXT_PUBLIC_API_URL`. Run **`bash scripts/preflight.sh`** to verify all of it at once before/after a deploy. Whatever the Google callbacks resolve to must also be registered in Google Cloud Console → OAuth 2.0 Client → Authorized redirect URIs.

### Bruno API collection
Requests live in `bruno/`. To manually trigger the scraper: **Run Scraper** (`POST /scraper/run`). The collection also includes RAG init/query requests and a health check.
