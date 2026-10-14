import '../env';

/**
 * Single source of truth for every public URL the API exposes.
 *
 * Set exactly two variables per deployment and everything else is derived:
 *
 *   API_URL        the public base URL of this API  (e.g. https://api.inferr.xyz)
 *   FRONTEND_URL   the public base URL of the web app (e.g. https://inferr.xyz)
 *
 * The Google OAuth callbacks and the MCP issuer are built from API_URL, so they
 * can never drift from the port/host the tunnel actually serves. Each of the
 * derived values can still be overridden explicitly (GOOGLE_CALLBACK_URL,
 * GOOGLE_MCP_CALLBACK_URL) but normally you should not need to.
 *
 * The functions (rather than module-level constants) are deliberate: they read
 * process.env at call time so import order never matters.
 */

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function isProduction(): boolean {
  return (
    process.env.NODE_ENV === 'production' ||
    process.env.DEPLOYMENT_ENV === 'production'
  );
}

/** Public base URL of the API. */
export function getApiUrl(): string {
  const raw = process.env.API_URL?.trim();
  if (raw) return stripTrailingSlash(raw);

  if (isProduction()) {
    throw new Error(
      'API_URL must be set in production (e.g. https://api.inferr.xyz). ' +
        'It is the single source of truth for this API’s public address.',
    );
  }
  return 'http://localhost:3001';
}

/** Public base URL of the web app (CORS origin + post-login redirect). */
export function getFrontendUrl(): string {
  const raw = process.env.FRONTEND_URL?.trim();
  if (raw) return stripTrailingSlash(raw);

  if (isProduction()) {
    throw new Error(
      'FRONTEND_URL must be set in production (e.g. https://inferr.xyz).',
    );
  }
  return 'http://localhost:3000';
}

/** Google OAuth callback for the web-app login flow. Derived from API_URL. */
export function getGoogleCallbackUrl(): string {
  return (
    process.env.GOOGLE_CALLBACK_URL?.trim() ||
    `${getApiUrl()}/auth/google/callback`
  );
}

/** Google OAuth callback for the MCP authorization flow. Derived from API_URL. */
export function getGoogleMcpCallbackUrl(): string {
  return (
    process.env.GOOGLE_MCP_CALLBACK_URL?.trim() ||
    `${getApiUrl()}/auth/google/mcp-callback`
  );
}
