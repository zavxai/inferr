# inferr

Personalized developer news feed powered by AI. Sign in with Google, pick interest tags, get articles from Hacker News and Dev.to ranked by vector similarity. Includes an agentic RAG chat to ask questions against your feed.

## Stack

| Layer | Tech |
|---|---|
| Frontend | Next.js 15, Tailwind CSS, TypeScript |
| Backend | NestJS 11, TypeScript |
| Database | PostgreSQL 16 + pgvector (Neon in prod, Docker locally), featuring distributed locks |
| Scheduling | External cron (cron-job.org) pings `/health` for keep-alive; GitHub Actions cron triggers daily pipeline; `@nestjs/schedule` runs internal crons backed by a database-backed distributed lock (`cron_locks` table) |
| ORM | Drizzle ORM |
| AI | OpenAI `gpt-4o-mini` + `text-embedding-3-small`; LangGraph agentic pipeline; LLM-as-judge evaluations |
| Auth | Google OAuth 2.0 → hashed refresh token (HttpOnly cookie, 7d) + short-lived JWT access token (15m); OAuth 2.1 + PKCE for MCP |
| Monorepo | pnpm workspaces + Turborepo |
| Deploy | API → Render, Web → Vercel, Local Kubernetes support (Minikube) |

## System Architecture

```mermaid
graph TD
    subgraph ClientSubgraph ["Client Layer"]
        UserBrowser["User Browser (Next.js 15)"]
        McpClient["MCP Client (e.g., Claude Desktop)"]
    end

    subgraph WebSubgraph ["Web Frontend (apps/web)"]
        NextJS["Next.js App"]
    end

    subgraph APISubgraph ["NestJS API (apps/api)"]
        AppCtrl["App Controller<br/>(Health Check)"]
        AuthMod["Auth Module<br/>(Google OAuth 2.0, JWT)"]
        FeedMod["Feed Module<br/>(Personalized feed)"]
        ChatMod["Chat Module<br/>(LangGraph RAG)"]
        ScraperMod["Scraper Module<br/>(Cheerio + APIs)"]
        JobsMod["Jobs Module<br/>(Jobs & Market Reports)"]
        McpMod["MCP Module<br/>(SSE & Tools)"]
        AiMod["AI Module<br/>(Embeddings & Processing)"]
        SchedMod["Scheduler Module<br/>(Cron & Distributed Locks)"]
        EvalMod["Evaluations Module<br/>(LLM-as-judge Evaluations)"]
        LangfuseMod["Langfuse Module<br/>(Tracing Integration)"]
    end

    subgraph DBSubgraph ["Database Layer (PostgreSQL)"]
        Postgres[(PostgreSQL + pgvector)]
        UsersT[(users / user_interests)]
        ArticlesT[(articles)]
        JobsT[(jobs / market_reports)]
        McpT[(mcp_tokens / mcp_clients)]
        RefreshTokensT[(refresh_tokens)]
        AiEvaluationsT[(ai_evaluations)]
        CronLocksT[(cron_locks)]
        McpAuthT[(pending_mcp_auths / pending_auth_codes)]
    end

    subgraph ExternalSubgraph ["External Services"]
        GoogleOAuth["Google OAuth 2.0"]
        OpenAI["OpenAI API<br/>(gpt-4o-mini / text-embedding-3-small)"]
        NewsAPIs["Hacker News & Dev.to APIs"]
        Cheerio["Article Websites (Scraping)"]
        GithubActions["GitHub Actions (Daily Scrape)"]
        CronJob["cron-job.org (Keep-alive)"]
        Jaeger["Jaeger (OTel Traces)"]
        LangfuseSrv["Langfuse Cloud/Self-hosted (Tracing)"]
    end

    %% Connections
    UserBrowser -->|UI Interactions| NextJS
    
    NextJS -->|Authenticate| AuthMod
    NextJS -->|Fetch Feed| FeedMod
    NextJS -->|Query Chat| ChatMod
    NextJS -->|View Jobs| JobsMod
    
    McpClient -->|SSE Connection & Tool Calls| McpMod

    %% Module flows
    AuthMod -->|OAuth Consent| GoogleOAuth
    AuthMod -->|Manage Users & Sessions| UsersT
    AuthMod -->|Rotate Tokens| RefreshTokensT

    FeedMod -->|Generate Query Vector| AiMod
    FeedMod -->|HNSW Vector Search| ArticlesT

    ChatMod -->|Orchestrate Agent Pipeline| OpenAI
    ChatMod -->|Retrieve Related Articles| ArticlesT
    ChatMod -->|Trigger Evaluations| EvalMod

    ScraperMod -->|Fetch Metadata| NewsAPIs
    ScraperMod -->|Cheerio Extract HTML| Cheerio
    ScraperMod -->|Save Parsed Content| ArticlesT

    AiMod -->|Summarize & Embed| OpenAI
    AiMod -->|Generate Embeddings| ArticlesT

    JobsMod -->|Trend Analysis| OpenAI
    JobsMod -->|Save Market Data| JobsT

    McpMod -->|Validate Session / Token| McpT
    McpMod -->|OAuth Bridging| McpAuthT
    McpMod -->|Expose Tools: search_articles, ask_inferr, etc.| Postgres

    SchedMod -->|Acquire Lock| CronLocksT
    SchedMod -->|Trigger Scrape & Jobs| ScraperMod
    SchedMod -->|Trigger Job Scrape| JobsMod

    EvalMod -->|Judge LLM Outputs| OpenAI
    EvalMod -->|Log Traces| LangfuseMod
    EvalMod -->|Save Evaluations| AiEvaluationsT

    LangfuseMod -->|Send Telemetry| LangfuseSrv

    %% Database internals
    Postgres === UsersT
    Postgres === ArticlesT
    Postgres === JobsT
    Postgres === McpT
    Postgres === RefreshTokensT
    Postgres === AiEvaluationsT
    Postgres === CronLocksT
    Postgres === McpAuthT

    %% External cron jobs
    GithubActions -->|Trigger Pipeline| ScraperMod
    CronJob -->|Ping /health| AppCtrl

    %% Styling
    classDef client fill:#EBF5FF,stroke:#2563EB,stroke-width:2px,color:#1E3A8A;
    classDef web fill:#F0FDF4,stroke:#16A34A,stroke-width:2px,color:#14532D;
    classDef api fill:#FFF7ED,stroke:#EA580C,stroke-width:2px,color:#7C2D12;
    classDef db fill:#F5F3FF,stroke:#7C3AED,stroke-width:2px,color:#4C1D95;
    classDef external fill:#F1F5F9,stroke:#475569,stroke-width:2px,color:#0F172A;

    class UserBrowser,McpClient client;
    class NextJS web;
    class AppCtrl,AuthMod,FeedMod,ChatMod,ScraperMod,JobsMod,McpMod,AiMod,SchedMod,EvalMod,LangfuseMod api;
    class Postgres,UsersT,ArticlesT,JobsT,McpT,RefreshTokensT,AiEvaluationsT,CronLocksT,McpAuthT db;
    class GoogleOAuth,OpenAI,NewsAPIs,Cheerio,GithubActions,CronJob,Jaeger,LangfuseSrv external;
```


## Structure

```
apps/
  api/    NestJS REST API       port 3001
  web/    Next.js frontend      port 3000
packages/
  types/  shared TypeScript types
docs/     architecture notes, OAuth setup, diagrams
```

## Local Setup

**Requirements:** Node.js 22, pnpm 10, Docker

```bash
# 1. Copy env
cp .env.example .env
# Fill in GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, OPENAI_API_KEY, SCRAPER_API_KEY

# 2. Start Postgres
docker compose up -d

# 3. Run migrations
cd apps/api && pnpm db:migrate

# 4. Start both apps
cd ../.. && pnpm dev
```

Docker port mapping: Postgres → `5433` (avoids conflicts with local installs).

## Environment Variables

Single `.env` at repo root, loaded by both apps.

```env
DB_HOST=localhost
DB_PORT=5433
DB_USER=postgres
DB_PASS=postgres
DB_NAME=ai_feed
DB_SSL=false

API_PORT=3001
NEXT_PUBLIC_API_URL=http://localhost:3001
FRONTEND_URL=http://localhost:3000

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=http://localhost:3001/auth/google/callback

JWT_SECRET=
OPENAI_API_KEY=
SCRAPER_API_KEY=
```

## Database

```bash
cd apps/api
pnpm db:generate   # generate migration SQL from schema changes
pnpm db:migrate    # apply pending migrations
pnpm db:seed       # upsert test user + interests
pnpm db:studio     # Drizzle Studio at https://local.drizzle.studio
```

Migrations run automatically on API startup in production.

**Schema tables:** `users`, `articles`, `refresh_tokens`, `mcp_tokens`, `user_interests`, `jobs`, `market_reports`, `ai_evaluations`, `mcp_clients`, `pending_mcp_authorizations`, `pending_auth_codes`, `cron_locks`

### Distributed Cron Locks

To prevent concurrent execution of cron tasks when running multiple replicas of the NestJS API (such as in a local Kubernetes deployment or during scaling on Render), the internal scheduler service ([scheduler.service.ts](file:///home/johnvesslyalti/johnvesslyalti_workspace/inferr/apps/api/src/scheduler/scheduler.service.ts)) implements a database-backed distributed lock mechanism:
* **Storage**: The `cron_locks` table stores a unique `job_name` (Primary Key) and `locked_at` timestamp.
* **Flow**:
  1. **Clean up**: Any expired lock for the job name (older than 6 hours) is deleted.
  2. **Acquisition**: A new row is inserted with the job's unique name. If another instance is running the job, the database constraint violation (duplicate key) is caught, and the current instance gracefully skips execution.
  3. **Execution**: The job callback is executed.
  4. **Release**: The lock is deleted from the `cron_locks` table in a `finally` block to release it for future runs.

---

## Ingestion Pipeline

Articles are scraped, enriched, and stored in three ordered stages. A **GitHub Actions cron** runs daily, waking the Render free-tier instance and calling `POST /scraper/run` with the `SCRAPER_API_KEY`.

```mermaid
sequenceDiagram
    participant Cron as GitHub Actions (daily)
    participant API as NestJS API
    participant Sources as HN / Dev.to APIs
    participant Sites as Article websites
    participant OpenAI
    participant DB as Postgres

    Cron->>API: POST /scraper/run (Bearer SCRAPER_API_KEY)

    rect rgb(235, 245, 255)
    Note over API,DB: Stage 1 — store metadata
    par Fetch in parallel
        API->>Sources: GET top articles (HN, Dev.to, Reddit, etc.)
    end
    Sources-->>API: title, url, source, tags, publishedAt
    Note over API: Filter: Keep only articles published within the last 24h
    API->>DB: INSERT articles (metadata only)<br/>ON CONFLICT (url) DO NOTHING
    DB-->>API: ids of NEW rows (duplicates skipped)
    end

    rect rgb(235, 255, 240)
    Note over API,DB: Stage 2 — scrape content (new rows only, batches of 5)
    loop for each batch of 5 new articles
        API->>Sites: GET article HTML (10s timeout)
        Sites-->>API: HTML (or block / paywall / error)
        Note over API: cheerio extracts text<br/>article → main → p<br/>cap 8000 chars · null on failure
        API->>DB: UPDATE articles SET content, content_scraped_at
    end
    end

    rect rgb(255, 245, 235)
    Note over API,DB: Stage 3 — summarize + embed (sequential, max 50)
    API->>DB: SELECT id, title, content<br/>WHERE summary IS NULL LIMIT 50
    loop one article at a time
        API->>OpenAI: summarize(title, content) — gpt-4o-mini
        OpenAI-->>API: 3-sentence summary
        API->>OpenAI: embed(summary + tags) — text-embedding-3-small
        OpenAI-->>API: [0.021, -0.043, ...] (1536 floats)
        API->>DB: UPDATE articles SET summary, embedding
    end
    API->>DB: Prune DB to keep top 100 articles (cleanOldArticles)
    end

    API-->>Cron: { saved, summarized, cleaned }
```

Each article row is written **three times** over the pipeline: metadata on insert, then `content`, then `summary` + `embedding`. Deduplication (`ON CONFLICT`), the 24-hour scraper check, and the `summary IS NULL` filter mean an article is only ever scraped and summarized **once**, saving database space and OpenAI API costs. Tags are included in the embedding input so vector similarity captures topic signals beyond the summary text.

## Feed Flow

The feed retrieves articles based on vector similarity, applying a strict 24-hour SQL filter, tag-overlap bonuses, and a source diversity check to ensure variety. If no articles clear the criteria, an empty feed is returned along with `hasMatches: false` so the UI can show a clean empty state recommending that the user expand their interests.

```mermaid
sequenceDiagram
    participant Browser
    participant Next.js
    participant NestJS
    participant OpenAI
    participant Postgres

    Browser->>Next.js: GET /feed
    Next.js->>NestJS: GET /feed (Bearer JWT)
    NestJS->>Postgres: SELECT tags FROM user_interests WHERE user_id = ?
    Postgres-->>NestJS: ["typescript", "rust"]
    NestJS->>OpenAI: embed("typescript rust")
    OpenAI-->>NestJS: [0.021, -0.043, ...] (1536 floats)
    NestJS->>Postgres: SELECT title, url, source, summary, tags, published_at<br/>FROM articles WHERE embedding IS NOT NULL AND created_at >= 24h ago<br/>ORDER BY embedding <=> query_vector LIMIT 60
    Note over Postgres: HNSW index → O(log n) ANN search
    Postgres-->>NestJS: top 60 fresh articles
    Note over NestJS: Apply tag-overlap boost (+0.15/tag, max 0.30)<br/>Filter: cosine distance < 0.5 (score >= 50%)<br/>Source Diversity: Select highest-ranked per source<br/>Sort final list by match score descending
    NestJS-->>Next.js: { hasMatches, articles, fallback: [] }
    Next.js-->>Browser: Rendered feed with real Match Scores (or empty state)
```

## Agentic Chat

The `/chat` endpoint uses a **LangGraph** stateful pipeline instead of a flat retrieve → generate chain. Multi-turn conversation history is accepted on every request.

```mermaid
flowchart LR
    A[retrieve\nfetch top articles\nby vector similarity] --> B[grade documents\nrelevance check\ngpt-4o-mini]
    B -->|all irrelevant| C[rewrite query\nusing conversation\nhistory · max 2×]
    C --> A
    B -->|at least one relevant| D[generate\ngrounded answer\n+ cited sources]
```

If the grader rejects all retrieved articles, the query rewriter reformulates using conversation history and retries (up to 2 times). This prevents hallucinated answers when the feed has no relevant content for the question.

An interactive vector diagram of this agent workflow is available at [docs/agent_chat_langgraph.excalidraw](file:///home/johnvesslyalti/johnvesslyalti_workspace/inferr/docs/agent_chat_langgraph.excalidraw).


## Auth Flow

```
GET /auth/google
  → Google consent screen
  → GET /auth/google/callback
  → upsert user in DB
  → create hashed refresh token (stored as SHA-256 in refresh_tokens table)
  → set HttpOnly refresh_token cookie (7 days)
  → redirect to /auth/callback (no token in URL)

POST /auth/refresh (cookie)
  → rotate refresh token (old revoked, new issued)
  → reuse detection: recently-revoked tokens within 5s grace window follow
    the replacement chain (safe for multi-tab)
  → return { accessToken } (JWT, 15 min)

Protected routes: Authorization: Bearer <accessToken>
POST /auth/logout → revoke refresh token, clear cookie
```

## API Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | — | Health check |
| GET | `/auth/google` | — | Start Google OAuth |
| GET | `/auth/google/callback` | — | OAuth callback, sets HttpOnly refresh cookie |
| POST | `/auth/refresh` | cookie | Rotate refresh token → return JWT access token |
| POST | `/auth/logout` | cookie | Revoke refresh token, clear cookie |
| GET | `/auth/me` | Bearer JWT | Current user + hasInterests flag |
| GET | `/users/interests` | Bearer JWT | Get saved interest tags |
| POST | `/users/interests` | Bearer JWT | Save interest tags |
| DELETE | `/users/me` | Bearer JWT | Delete user account and cascade-delete all personal data |
| GET | `/feed` | Bearer JWT | Personalized article feed with relevance filtering |
| POST | `/chat` | Bearer JWT | Agentic RAG chat (supports conversation history) |
| POST | `/scraper/run` | `SCRAPER_API_KEY` | Run full pipeline: scrape → content → summarize |
| GET | `/jobs/market` | — | Fetch job demand stats |
| GET | `/jobs/report` | — | Fetch market reports |
| POST | `/jobs/scrape` | `SCRAPER_API_KEY` | Scrape latest jobs |
| POST | `/mcp` | Bearer Token | Handle Model Context Protocol (MCP) tool call request |
| GET | `/mcp` | Bearer Token | Handle Model Context Protocol (MCP) SSE stream request |
| DELETE | `/mcp` | Bearer Token | Handle Model Context Protocol (MCP) close session request |


## Observability

Inferr integrates tracing and LLM evaluation tools to debug and monitor performance in development and production:

### 1. Application Tracing (OpenTelemetry + Jaeger)
System-wide operations (HTTP routing, database queries, and external fetches) are auto-instrumented using OpenTelemetry Node SDK ([otel.ts](file:///home/johnvesslyalti/johnvesslyalti_workspace/inferr/apps/api/src/otel.ts)):
* **Local Jaeger UI**: Accessible at [http://localhost:16686](http://localhost:16686).
* **Launch**: Runs automatically when starting services via `docker compose up -d` (uses port `4318` for HTTP OTLP trace exports).

### 2. LLM Tracing & Evaluation (Langfuse)
AI pipeline steps (the LangGraph RAG Agentic Chat, prompt revisions, document grading, and faithfulness evaluations) are tracked via Langfuse integration:
* **Local Langfuse Dashboard**: Runs at [http://localhost:3010](http://localhost:3010).
* **Launch**: Start the Langfuse PostgreSQL and web containers separately:
  ```bash
  docker compose -f docker-compose.langfuse.yml up -d
  ```
* **Configuration**: Set the keys in your `.env` file (find public/secret keys inside the local dashboard project settings):
  ```env
  LANGFUSE_PUBLIC_KEY=lf-pub-...
  LANGFUSE_SECRET_KEY=lf-sec-...
  LANGFUSE_BASE_URL=http://localhost:3010
  ```

---

## Deployment

**API (Render):** Set env vars, deploy from `Dockerfile`. `DATABASE_URL` overrides the individual `DB_*` vars. A daily GitHub Actions workflow (`.github/workflows/daily-scrape.yml`) calls `POST /scraper/run` with `SCRAPER_API_KEY` — add that secret to both Render and the GitHub repo.

**Keeping the free-tier API warm:** Render's free instance sleeps after 15 min idle. GitHub Actions cron is too unreliable for short-interval keep-alive pings, so an external pinger ([cron-job.org](https://cron-job.org)) does a `GET https://api.inferr.xyz/health` every 10 min, restricted to hours 0–18 UTC (~06:00–24:00 IST) to stay within the 750 hr/month budget. The instance is allowed to sleep overnight; the web app's wake overlay (`apps/web/src/lib/server-status.tsx`) covers the first cold request.

**Web (Vercel):** Set `NEXT_PUBLIC_API_URL` to the Render API URL. `vercel.json` at root handles the monorepo build pointing to `apps/web`.

---

## Kubernetes (Local Deployment)

This project contains a complete, local Kubernetes deployment setup located in the [kubernetes/](file:///home/johnvesslyalti/johnvesslyalti_workspace/inferr/kubernetes/) directory. This allows you to run, manage, and test the entire backend infrastructure (NestJS API, Postgres with pgvector, Redis, migrations, and cronjobs) inside a local Kubernetes cluster.

### Architecture
![Kubernetes Architecture Diagram](docs/k8s_architecture.jpg)

### Prerequisites
* **Docker**
* **Minikube**
* **kubectl** & **Helm**

### Launching the Cluster Locally
1. **Start Minikube**:
   ```bash
   minikube start --driver=docker
   ```
2. **Build the API container inside Minikube**:
   Build the NestJS API container image directly in the Minikube registry:
   ```bash
   minikube image build -t inferr-api:latest .
   ```
3. **Apply the manifests**:
   Deploy all resources (Secrets, ConfigMaps, Postgres StatefulSet, Redis, API, and Ingress) to your cluster:
   ```bash
   kubectl apply -f kubernetes/
   ```
4. **Enable Ingress**:
   Enable the Nginx Ingress Controller addon:
   ```bash
   minikube addons enable ingress
   ```

### Accessing the API
1. Map the domain `api.inferr.local` to your Minikube IP:
   ```bash
   echo "$(minikube ip) api.inferr.local" | sudo tee -a /etc/hosts
   ```
2. Open `http://api.inferr.local/health` in your browser. You should receive:
   ```json
   { "status": "ok" }
   ```

### Managing the Pipeline
* **Trigger the daily scraper manually**:
  ```bash
  kubectl create job --from=cronjob/scraper-cronjob scraper-manual-run
  ```
* **View the scraper logs**:
  ```bash
  kubectl logs -f -l job-name=scraper-manual-run
  ```
* **Verify Pod status**:
  ```bash
  kubectl get pods
  ```

### Task Scheduling & Observability in Kubernetes

When deploying the API service to Kubernetes:
1. **Internal Scheduler Coordination**: The API containers run the NestJS internal scheduler. If scaled to multiple replicas, the pods coordinate scheduled executions (`runDailyScrape` and `runDailyJobScrape`) using the `cron_locks` database table. Only one pod acquires the lock and runs the task; other pods log a warning and gracefully skip the run.
2. **External Trigger Alternative**: The included `scraper-cronjob.yaml` manifest triggers the scraper pipeline externally via a cURL command. If you rely solely on this external controller, you may disable internal scheduling parameters or allow the database distributed lock to coordinate.
3. **Observability Integration**: Jaeger tracing and Langfuse logs can be routed from within the Kubernetes cluster. Customize the variables in `kubernetes/configmap.yaml` (e.g. `LANGFUSE_BASE_URL` and `OTEL_EXPORTER_OTLP_ENDPOINT`) and add your Langfuse keys to `kubernetes/secrets.yaml`.
