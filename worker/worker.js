/**
 * BusinessKoro Storefront API — Cloudflare Worker proxy
 * -----------------------------------------------------
 * Purpose: keep BK_API_KEY out of the browser. The static storefront calls
 * this Worker; the Worker adds the x-api-key header server-side and forwards
 * the request to the BusinessKoro API.
 *
 * Routes
 *   GET  /products          -> GET  {BASE}/products
 *   POST /orders            -> POST {BASE}/orders
 *   GET  /orders/:id        -> GET  {BASE}/orders/:id
 *   GET  /health            -> config sanity check (no key echoed)
 *
 * Environment (set in the Cloudflare dashboard, never in this file)
 *   BK_API_KEY       (Secret)    e.g. wrangler secret put BK_API_KEY
 *   BK_API_BASE_URL  (Variable)  https://api.businesskoro.com/api/v1/storefront
 *
 * Design rules honoured here:
 *   - No mock data. No fabricated success. Every response is the real
 *     upstream status code and body, passed through unchanged.
 *   - Upstream failures are surfaced with their real status + body, plus a
 *     short `upstream` diagnostic block so the cause is visible, not hidden.
 *   - The API key is never returned to the client, never logged, and never
 *     included in an error message.
 */

const DEFAULT_BASE = 'https://api.businesskoro.com/api/v1/storefront';

/* Origins allowed to call this Worker from a browser.
   Add your published site origin(s) here. '*' is intentionally NOT used
   for credentialed routes; these are public read/write storefront routes,
   so '*' is acceptable, but pinning the origin is better. */
const ALLOWED_ORIGINS = [
  'https://static.teamily.ai',
  'https://teamily.ai',
  'https://raydev-xyz.github.io',
];

function corsHeaders(origin) {
  const allow =
    !origin ? '*' :
    (ALLOWED_ORIGINS.indexOf(origin) !== -1 ? origin : ALLOWED_ORIGINS[0]);
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Accept',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(body, status, origin, extra) {
  return new Response(JSON.stringify(body), {
    status: status,
    headers: Object.assign(
      { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      corsHeaders(origin),
      extra || {}
    ),
  });
}

/* Strip anything that could leak the key out of an upstream body. */
function scrub(text, key) {
  if (!text) return text;
  let out = text;
  if (key && key.length > 6) out = out.split(key).join('[redacted]');
  return out;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    /* ---- CORS preflight ---- */
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    /* ---- config check ---- */
    const BASE = (env.BK_API_BASE_URL || DEFAULT_BASE).replace(/\/+$/, '');
    const KEY = env.BK_API_KEY;

    if (path === '/health') {
      return json({
        ok: true,
        worker: 'bk-storefront-proxy',
        base_url: BASE,
        key_configured: !!KEY,
        key_length: KEY ? KEY.length : 0,
        allowed_origins: ALLOWED_ORIGINS,
      }, 200, origin);
    }

    if (!KEY) {
      /* Real misconfiguration — say so plainly, do not pretend to work. */
      return json({
        error: 'Worker misconfigured',
        detail: 'BK_API_KEY is not set on this Worker. Run: wrangler secret put BK_API_KEY',
        statusCode: 500,
      }, 500, origin);
    }

    /* ---- route table ---- */
    let upstreamPath = null;
    let method = request.method;

    if (path === '/products' && method === 'GET') {
      upstreamPath = '/products';
    } else if (path === '/orders' && method === 'POST') {
      upstreamPath = '/orders';
    } else if (/^\/orders\/[^/]+$/.test(path) && method === 'GET') {
      upstreamPath = path; // /orders/{orderId}
    } else {
      return json({
        error: 'Not found',
        detail: 'Supported: GET /products, POST /orders, GET /orders/:id, GET /health',
        statusCode: 404,
      }, 404, origin);
    }

    /* ---- build upstream request ---- */
    const target = BASE + upstreamPath + (url.search || '');
    const headers = {
      'x-api-key': KEY,
      'Accept': 'application/json',
    };

    let body;
    if (method === 'POST') {
      const raw = await request.text();
      body = raw || '{}';
      headers['Content-Type'] = 'application/json';
    }

    let upstream;
    try {
      upstream = await fetch(target, {
        method: method,
        headers: headers,
        body: body,
        redirect: 'follow',
      });
    } catch (err) {
      /* Network-level failure — report it as such. */
      return json({
        error: 'Upstream unreachable',
        detail: String(err && err.message ? err.message : err),
        target: target,
        statusCode: 502,
      }, 502, origin);
    }

    const text = scrub(await upstream.text(), KEY);
    const contentType = upstream.headers.get('Content-Type') || 'application/json';

    /* Pass the real status through. On auth failure, add a diagnostic block
       so the exact reason is visible instead of being masked. */
    if (upstream.status === 401 || upstream.status === 403) {
      let parsed = null;
      try { parsed = JSON.parse(text); } catch (e) { /* keep raw */ }
      return json({
        error: 'BusinessKoro rejected the API key',
        upstream_status: upstream.status,
        upstream_body: parsed || text,
        diagnosis: 'The Worker sent x-api-key to ' + BASE + '/products and the API refused it. ' +
                   'The key value is invalid, revoked, expired, or belongs to a different store. ' +
                   'Verify BK_API_KEY in the Cloudflare dashboard matches an active storefront key.',
        statusCode: upstream.status,
      }, upstream.status, origin);
    }

    return new Response(text, {
      status: upstream.status,
      headers: Object.assign(
        { 'Content-Type': contentType, 'Cache-Control': 'no-store' },
        corsHeaders(origin)
      ),
    });
  },
};
