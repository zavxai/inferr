# Inferr Project Context

## Project

Inferr is a pnpm/Turborepo monorepo for a personalized developer-news feed.

- Frontend: Next.js in `apps/web`, normally port `3000`.
- Backend: NestJS in `apps/api`, normally port `3001`.
- Database: PostgreSQL 16 with pgvector, managed locally by Docker Compose.
- Supporting service: Jaeger for OpenTelemetry traces.
- Authentication: Google OAuth with HttpOnly refresh-token cookies and JWT access tokens.
- AI integrations: OpenAI, LangGraph, and optional Langfuse tracing.

## Public Hosting Setup (Current Production Migration)

The frontend has been deployed to **Vercel**. The backend remains on the user's **Arch Linux laptop** behind a permanent **Cloudflare Tunnel**.

- **Domain**: `inferr.xyz` — purchased on GoDaddy, nameservers delegated to Cloudflare.
- **Tunnel ID**: `08bd9db4-7428-419a-96d5-1b99bbaf43ae`
- **Tunnel token**: Do not store this credential in the repository or documentation. Use a rotated token from a secret manager or local environment variable.
- **Vercel project**: `johnvessly-altis-projects/inferr`
- **Vercel production URL**: `https://inferr.vercel.app` (verified HTTP 200)
- **Vercel deployment**: `https://inferr-crxny53mq-johnvessly-altis-projects.vercel.app` (production, Ready)

### DNS Records — Completed Cutover

`inferr.xyz` is served by Vercel. Cloudflare remains the authoritative DNS provider, so the apex record directs visitors to Vercel while the API subdomain continues through the Cloudflare Tunnel.

| Hostname | Current Record | Required Record | Notes |
|---|---|---|---|
| `inferr.xyz` | **A → `76.76.21.21`, DNS-only** | — | Frontend served by Vercel; verified HTTP 200 on 2026-08-09. |
| `api.inferr.xyz` | CNAME → `08bd9db4-7428-419a-96d5-1b99bbaf43ae.cfargotunnel.com` | **No change** | Must continue to route the NestJS API through the tunnel. |

### Tunnel Routing
| Public URL | Target |
|---|---|
| `https://inferr.xyz` | Vercel frontend (after apex DNS cutover) |
| `https://api.inferr.xyz` | `http://localhost:3001` through Cloudflare Tunnel |

## Local Runtime

Expected local services:

```text
Frontend:  Vercel → https://inferr.xyz (live)
API:       http://localhost:3001 → https://api.inferr.xyz
Postgres:  localhost:5432 (Docker; local-only; do not publish)
Jaeger:    localhost:16686 (local-only; do not publish)
```

### Start All Services

**Step 1 — Start Cloudflare Tunnel:**
```bash
cloudflared tunnel run --token "$CLOUDFLARED_TUNNEL_TOKEN"
```

Set `CLOUDFLARED_TUNNEL_TOKEN` from a secure local source; rotate the previously exposed token before using it again.

**Step 2 — Start backend (Docker):**
```bash
sudo systemctl enable --now docker
docker compose up -d postgres jaeger api
```

The local frontend is no longer required for production once the Vercel DNS cutover is complete. It can still be run locally for development.

## Environment Files

### `.env` (root, used by API/Docker)
- `NODE_ENV=production`
- `FRONTEND_URL=https://inferr.xyz`
- `NEXT_PUBLIC_API_URL=https://api.inferr.xyz`
- `API_URL=https://api.inferr.xyz`
- `GOOGLE_CALLBACK_URL=https://api.inferr.xyz/auth/google/callback`

### `apps/web/.env.local` (used by Next.js build — CRITICAL)
```env
NEXT_PUBLIC_API_URL=https://api.inferr.xyz
FRONTEND_URL=https://inferr.xyz
API_URL=https://api.inferr.xyz
GOOGLE_CALLBACK_URL=https://api.inferr.xyz/auth/google/callback
```

> **Important**: `NEXT_PUBLIC_API_URL` is baked into the JS bundle at build time.
> After any change to this file, always run `pnpm --filter @ai-developer-feed/web build` before `start`.

## Current Status (2026-08-09)

| Component           | Status                                |
|---------------------|---------------------------------------|
| Cloudflare Tunnel   | ✅ Set up; retained for `api.inferr.xyz` only |
| Cloudflare DNS      | ✅ Apex now points to Vercel; `api.inferr.xyz` remains assigned to the tunnel |
| Vercel frontend     | ✅ Deployed and Ready at `https://inferr.vercel.app` |
| Vercel custom domain | ✅ `https://inferr.xyz` serves the frontend (HTTP 200) |
| Cloudflared daemon  | ⚠️ Needs restart (server restarted)   |
| Backend API         | ❌ Docker service is inactive and disabled; after enabling Docker, start `postgres`, `jaeger`, and `api` containers |
| Google OAuth        | ⚠️ Callback URL must be added to Google Cloud Console as `https://api.inferr.xyz/auth/google/callback` |

## Known Issues & Next Steps

1. **Bring the API back online** — Docker is currently inactive/disabled. Run `sudo systemctl enable --now docker`, then `docker compose up -d postgres jaeger api`. Start the Cloudflare Tunnel with a rotated token. Until then, `api.inferr.xyz` returns a Cloudflare 530 response.
2. **Google OAuth callback** — Must add `https://api.inferr.xyz/auth/google/callback` to the authorized redirect URIs in Google Cloud Console ([console.cloud.google.com](https://console.cloud.google.com)).
3. **Configure `www` only if desired** — `www.inferr.xyz` is not configured and has an SSL hostname mismatch. Add it in Vercel and create an appropriate Cloudflare DNS record/redirect if it should be supported.
4. **Persistent startup** — To survive reboots, keep `cloudflared` and the backend Docker services under systemd. The frontend no longer needs a local production server after DNS cutover.

## Public URL Configuration

The following values must match the chosen public hostnames before testing OAuth:

- `NEXT_PUBLIC_API_URL`: `https://api.inferr.xyz`
- `FRONTEND_URL`: `https://inferr.xyz`
- `API_URL`: `https://api.inferr.xyz`
- `GOOGLE_CALLBACK_URL`: `https://api.inferr.xyz/auth/google/callback`

The matching callback URL must also be added to the Google Cloud OAuth client. Do not commit `.env` or any secret values.

## Important Repository State

These files were edited and must be preserved:

```text
apps/api/src/main.ts         — improved error logging in bootstrap()
apps/web/src/app/page.tsx    — active Google Sign-in buttons (not maintenance mode)
apps/web/src/app/globals.css — @keyframes revealIn for .reveal hero animation fix
apps/web/.env.local          — NEXT_PUBLIC_API_URL=https://api.inferr.xyz (production URLs)
.env                         — production domain URLs for API
```

## Architecture Notes

- **pnpm binary path**: `/home/johnvesslyalti/.npm-global/bin/pnpm` — always include `export PATH=$PATH:/home/johnvesslyalti/.npm-global/bin` in bash commands.
- **sudo**: Requires interactive password; background non-interactive sudo tasks will fail.
- **Cloudflare Tunnel billing bypass**: Zero Trust dashboard prompts for credit card even on free plan. Bypass: run `cloudflared tunnel run --token <TOKEN>` directly and set CNAME records manually in Cloudflare DNS.
- **Next.js static build**: Pages like `/`, `/feed`, `/chat`, `/dashboard`, `/onboarding` are statically prerendered. `NEXT_PUBLIC_*` env vars are embedded at build time — rebuild required after any change.
