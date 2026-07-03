# Monorepo Structure

Turborepo + pnpm workspaces monorepo for inferr.

## Directory Structure

```
.
├── apps/
│   ├── api/                 # NestJS backend API (port 3001)
│   └── web/                 # Next.js 15 frontend (port 3000)
├── packages/
│   └── types/               # Shared TypeScript types
├── docs/                    # Architecture notes, OAuth setup
├── bruno/                   # Bruno API collection
├── docker-compose.yml       # Local Postgres (port 5433)
├── turbo.json               # Turborepo task graph
├── pnpm-workspace.yaml      # pnpm workspace definition
└── package.json             # Root workspace scripts
```

## Getting Started

**Prerequisites:** Node.js 22+, pnpm 10+, Docker

```bash
pnpm install
```

## Development

```bash
# Start all dev servers (API + web)
pnpm dev

# Or run a specific app
cd apps/api && pnpm dev
cd apps/web && pnpm dev
```

## Building

```bash
# Build all packages with Turborepo caching
pnpm build
```

## Testing

```bash
pnpm test
```

## Linting

```bash
pnpm lint
```

## Deployment

### Frontend (Next.js) — Vercel
- Set `NEXT_PUBLIC_API_URL` to the Render API URL.
- `vercel.json` at repo root points the build to `apps/web`.

### Backend (NestJS) — Render
- Deploy from `Dockerfile` in `apps/api`.
- Set env vars: `DATABASE_URL`, `JWT_SECRET`, `OPENAI_API_KEY`, `SCRAPER_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.

## Key Design Decisions

- **No repository layer** — services query Drizzle ORM directly. No TypeORM, no Prisma.
- **Single `.env`** at repo root — loaded by both apps via dotenv.
- **Turborepo caching** — `pnpm build` caches compiled outputs in `.turbo/`. Run `pnpm clean` to bust the cache.
