# Deployment & environment

This project is self-hosted: a **dev/** checkout is used for development and a
**prod/** checkout runs on the server (the laptop) behind a `cloudflared`
tunnel. This file records the rules that keep them from fighting each other.

## Source of truth

- **Repository/branch:** `johnvesslyalti/inferr` → `main` is canonical.
- Develop on a branch (e.g. under the `zavxai` fork), open a PR, merge to `main`.
- Production pulls `main`. Nothing else.

## The golden rule

> **Code is shared through git. Values are NOT.** Every machine has its own
> `.env`, and `.env` is gitignored so it never travels. Never `cp .env.example
> .env` on the server — the example contains `localhost` defaults that will
> overwrite your real production values.

## Single source of truth for ports & URLs

Set these in each machine's `.env`; everything else is derived (see
`apps/api/src/config/public-urls.ts`):

```
API_URL=http://localhost:3001        # public base URL of the API
FRONTEND_URL=http://localhost:4000   # public base URL of the web app
NEXT_PUBLIC_API_URL=http://localhost:3001   # what the browser calls; MUST equal API_URL
API_HOST_PORT=3001                   # host port the API is published on (prod: MUST equal the tunnel target)
```

Derived automatically — do not set unless overriding:
- `GOOGLE_CALLBACK_URL` → `${API_URL}/auth/google/callback`
- `GOOGLE_MCP_CALLBACK_URL` → `${API_URL}/auth/google/mcp-callback`
- MCP issuer + `WWW-Authenticate` → `API_URL`
- CORS origin → `FRONTEND_URL`

| | Dev machine | Prod machine |
|---|---|---|
| `API_HOST_PORT` | `4001` | `3001` |
| `API_URL` / `NEXT_PUBLIC_API_URL` | `http://localhost:4001` | `https://api.inferr.xyz` |
| `FRONTEND_URL` | `http://localhost:4000` | `https://inferr.xyz` |

Same code, different `.env` → both correct. Because the port now flows from
`.env` (not from the code), **pulling `main` can never change your port again.**

## The production chain

All four must agree:

```
cloudflared tunnel ──▶ http://localhost:${API_HOST_PORT}
docker-compose     ──▶ publishes ${API_HOST_PORT}:${API_PORT}
API_URL            ──▶ the public URL that tunnel serves
NEXT_PUBLIC_API_URL──▶ the URL the browser calls
```

The one link git can't touch is the **tunnel target** (Cloudflare dashboard,
remote-managed). If you change `API_HOST_PORT` on prod, update the tunnel too.

## Deploying

```bash
# 1. verify the chain BEFORE touching anything
bash scripts/preflight.sh

# 2. get the new code
git pull origin main

# 3. rebuild + restart
docker compose up -d --build

# 4. verify again
bash scripts/preflight.sh
```

`preflight.sh` checks:

- the API answers on `http://localhost:${API_HOST_PORT}/health`
- the public `${API_URL}/health` reaches it (tunnel in place)
- `NEXT_PUBLIC_API_URL == API_URL`
- it prints the tunnel target and the Google redirect URIs to register.

## Google OAuth

The callbacks are derived from `API_URL`. Whatever they resolve to must also be
registered in **Google Cloud Console → OAuth 2.0 Client → Authorized redirect
URIs**:

- `${API_URL}/auth/google/callback`
- `${API_URL}/auth/google/mcp-callback`

## Other ports

- `API_PORT` (container listen, default `3001`) — internal, fixed.
- `DB_HOST_PORT` (host publish, default `5434`) — container is always `5432`.
- `WEB_PORT` (default `4000`).
