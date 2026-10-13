/**
 * Origin fallback for inferr.xyz.
 *
 * Bind this Worker to inferr.xyz/* in Cloudflare and set ORIGIN_HOST to the
 * DNS-only hostname (or IP-backed hostname) of the self-hosted web server.
 * A Worker runs at Cloudflare's edge, so it can return this page even when the
 * origin machine is stopped and Cloudflare would otherwise show error 521/522.
 */
export interface Env {
  ORIGIN_HOST: string;
}

const outagePage = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Inferr is taking a short break</title><meta name="theme-color" content="#101713">
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#f4f1e8;color:#15221b;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.card{max-width:640px;text-align:center}.mark{width:58px;height:58px;border-radius:18px;margin:0 auto 30px;display:grid;place-items:center;background:#1d4d3d;color:#f7f4eb;font:700 31px Georgia,serif;box-shadow:0 12px 30px #1d4d3d2e}h1{font:500 clamp(2.4rem,8vw,4.8rem)/.98 Georgia,serif;letter-spacing:-.05em;margin:0}p{font-size:1.12rem;line-height:1.65;max-width:500px;margin:25px auto;color:#506057}.pill{display:inline-flex;gap:9px;align-items:center;margin-top:13px;padding:10px 14px;border:1px solid #ced8cf;border-radius:99px;background:#fbfaf6;color:#425249;font-size:.9rem}.dot{width:8px;height:8px;border-radius:50%;background:#d68243;box-shadow:0 0 0 4px #f7e6d8}button{margin-top:34px;border:0;border-radius:10px;background:#1d4d3d;color:white;font:600 15px inherit;padding:13px 19px;cursor:pointer}button:hover{background:#143a2d}.note{font-size:.83rem;color:#78847b;margin-top:22px}
</style></head><body><main class="card"><div class="mark">i</div><h1>We&rsquo;ll be right back.</h1><p>Inferr&rsquo;s server is temporarily offline while it wakes up or gets a little maintenance. Your account and saved preferences are safe.</p><div class="pill"><span class="dot"></span>Service is temporarily unavailable</div><br><button type="button" onclick="location.reload()">Try again</button><p class="note">Thanks for your patience.</p></main></body></html>`;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    url.hostname = env.ORIGIN_HOST;
    // Keep the original host for the self-hosted reverse proxy, while sending
    // the network request to the unproxied origin configured above.
    const originRequest = new Request(url, request);
    originRequest.headers.set('Host', new URL(request.url).hostname);

    try {
      const response = await fetch(originRequest);
      if (response.status < 520) return response;
    } catch {
      // Connection, TLS, and timeout failures all use the same friendly page.
    }

    return new Response(outagePage, {
      status: 503,
      headers: {
        'content-type': 'text/html; charset=UTF-8',
        'cache-control': 'no-store, max-age=0',
        'retry-after': '60',
      },
    });
  },
} satisfies ExportedHandler<Env>;
