# Cloudflare origin fallback

This Worker replaces Cloudflare's generic origin errors with Inferr's outage
page. It runs at the edge, so a page inside the Next.js app would not be
enough: that app is unavailable at exactly the moment it is needed.

1. Create a DNS-only hostname for the self-hosted web server, for example
   `origin.inferr.xyz` (grey cloud), and point it at the server IP.
2. From this directory, authenticate once with `pnpm dlx wrangler login`.
3. Set the origin hostname: `pnpm dlx wrangler secret put ORIGIN_HOST` and
   enter `origin.inferr.xyz`.
4. Deploy: `pnpm dlx wrangler deploy`.

The `inferr.xyz/*` route in `wrangler.jsonc` makes the Worker proxy normal
traffic and return HTTP 503 only when the origin cannot be reached. Add a
second route for `www.inferr.xyz/*` if that hostname also serves the app.

Do not use the orange-cloud `inferr.xyz` hostname as `ORIGIN_HOST`; that would
make the Worker call itself.
