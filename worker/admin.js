/**
 * Trendy Choice — store settings service (Cloudflare Worker, v2)
 * -------------------------------------------------------------
 * This is the SECOND Worker. `worker/worker.js` (the BusinessKoro proxy at
 * trendy.r4ydevbd.workers.dev) is left untouched — it keeps serving the
 * catalogue and orders exactly as before. This one stores the handful of
 * choices the shop owner makes in the admin panel, so the store and the admin
 * panel read and write ONE shared document instead of two copies.
 *
 * Routes
 *   GET  /                 -> the settings document (public: the shop reads it)
 *   PUT  /                 -> replace the settings       (x-admin-token)
 *   GET  /orders           -> orders placed through the storefront (x-admin-token)
 *   POST /orders           -> append one order record    (x-store-key or x-admin-token)
 *   PATCH /orders/:id      -> flip one field on an order (x-admin-token)
 *   GET  /health           -> liveness / configuration check
 *
 * The document
 *   {
 *     v, updatedAt,
 *     hero: { slides: [url, ...] },   banner image URLs, in order
 *     hidden: [productKey, ...],      never shown in the shop
 *     pinned: [productKey, ...],      pinned to the top, in this order
 *     price:  { productKey: number }, price override in BDT
 *     newArrivals: [productKey, ...], shown in the New Arrival slider
 *     copy:   { headline: string }    optional section headline
 *   }
 *   A product key is the id the storefront already uses: "7" for a bundled
 *   product, "bk:<uuid>" for a product that exists only in BusinessKoro.
 *
 * Two different keys, deliberately:
 *   ADMIN_TOKEN  lets a human change the store (config writes, order reads).
 *   STORE_KEY    only lets the public storefront APPEND an order, so the
 *                checkout can add to the order board without shipping the
 *                admin password to the browser. It cannot read anything.
 *
 * Environment (set with wrangler / the Cloudflare dashboard, never in git)
 *   ADMIN_TOKEN  (Secret)  the admin panel's password
 *   STORE_KEY    (Secret)  write-only key embedded in the storefront
 *   STORE_CONFIG (KV)      binding that stores the document
 */

const ALLOWED_ORIGINS = [
  'https://raydev-xyz.github.io',
  'https://static.teamily.ai',
  'https://teamily.ai',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
];

const CONFIG_KEY = 'store-config';
const ORDERS_KEY = 'order-log';
const ORDERS_CAP = 400;

function emptyConfig() {
  return {
    v: 1,
    updatedAt: null,
    hero: { slides: [] },
    hidden: [],
    pinned: [],
    price: {},
    newArrivals: [],
    copy: {},
  };
}

function cors(origin) {
  const allow = !origin ? '*'
    : (ALLOWED_ORIGINS.indexOf(origin) !== -1 ? origin : ALLOWED_ORIGINS[0]);
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET,PUT,POST,PATCH,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Accept,x-admin-token,x-store-key',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status: status,
    headers: Object.assign(
      { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      cors(origin)
    ),
  });
}

function readJson(env, key, fallback) {
  if (!env.STORE_CONFIG) return Promise.resolve(fallback);
  return env.STORE_CONFIG.get(key, 'json').then((v) => (v == null ? fallback : v)).catch(() => fallback);
}

function writeJson(env, key, value) {
  if (!env.STORE_CONFIG) return Promise.reject(new Error('STORE_CONFIG KV binding is missing'));
  return env.STORE_CONFIG.put(key, JSON.stringify(value));
}

/* Merge whatever is stored over the defaults, so a partial document still
   produces a complete, predictable config. */
function normalize(raw) {
  const out = Object.assign(emptyConfig(), raw && typeof raw === 'object' ? raw : {});
  out.hero = Object.assign({ slides: [] }, raw && raw.hero ? raw.hero : {});
  if (!Array.isArray(out.hero.slides)) out.hero.slides = [];
  out.hero.slides = out.hero.slides.filter((s) => typeof s === 'string' && s);
  ['hidden', 'pinned', 'newArrivals'].forEach((k) => {
    if (!Array.isArray(out[k])) out[k] = [];
    out[k] = out[k].map(String).filter(Boolean);
    out[k] = out[k].filter((v, i) => out[k].indexOf(v) === i);
  });
  if (!out.price || typeof out.price !== 'object' || Array.isArray(out.price)) out.price = {};
  const price = {};
  Object.keys(out.price).forEach((k) => {
    const n = Number(out.price[k]);
    if (isFinite(n) && n > 0) price[k] = Math.round(n);
  });
  out.price = price;
  if (!out.copy || typeof out.copy !== 'object' || Array.isArray(out.copy)) out.copy = {};
  out.v = 2;
  return out;
}

function safeEqual(given, want) {
  if (!want) return false;
  let diff = given.length ^ want.length;
  for (let i = 0; i < want.length; i++) diff |= (given.charCodeAt(i) || 0) ^ want.charCodeAt(i);
  return diff === 0;
}

function adminOk(request, env) {
  return safeEqual(request.headers.get('x-admin-token') || '', env.ADMIN_TOKEN || '');
}

/* The storefront may only APPEND an order. It can never read the board,
   the settings, or anything else. */
function storeKeyOk(request, env) {
  return safeEqual(request.headers.get('x-store-key') || '', env.STORE_KEY || '');
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = request.method;

    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors(origin) });
    }

    if (path === '/health') {
      return json({
        ok: true,
        worker: 'tc-store-config',
        version: 2,
        admin_configured: !!env.ADMIN_TOKEN,
        store_key_configured: !!env.STORE_KEY,
        config_store: !!env.STORE_CONFIG,
      }, 200, origin);
    }

    const storeReady = !!env.STORE_CONFIG;

    /* ---------------- settings ---------------- */
    if (path === '/' || path === '/config') {
      if (method === 'GET') {
        const stored = await readJson(env, CONFIG_KEY, null);
        return json({
          config: normalize(stored),
          source: stored ? 'kv' : 'default',
          store: storeReady,
        }, 200, origin);
      }

      if (method === 'PUT' || method === 'POST') {
        if (!env.ADMIN_TOKEN) {
          return json({
            error: 'Admin access is not configured',
            detail: 'ADMIN_TOKEN is not set on this Worker, so nobody can change the store yet.',
            statusCode: 500,
          }, 500, origin);
        }
        if (!adminOk(request, env)) {
          return json({ error: 'Not authorised', detail: 'Send the admin token in the x-admin-token header.', statusCode: 401 }, 401, origin);
        }
        if (!storeReady) {
          return json({ error: 'No storage attached', detail: 'The STORE_CONFIG KV binding is missing.', statusCode: 500 }, 500, origin);
        }
        let body;
        try { body = await request.json(); }
        catch (e) { return json({ error: 'Invalid JSON body', statusCode: 400 }, 400, origin); }

        const next = normalize(body && body.config ? body.config : body);
        next.updatedAt = new Date().toISOString();
        try { await writeJson(env, CONFIG_KEY, next); }
        catch (e) { return json({ error: 'Could not save the settings', detail: String(e && e.message || e), statusCode: 500 }, 500, origin); }

        return json({ ok: true, config: next }, 200, origin);
      }

      return json({ error: 'Method not allowed', allow: 'GET, PUT', statusCode: 405 }, 405, origin);
    }

    /* ---------------- orders ---------------- */
    if (path === '/orders') {
      if (method === 'GET') {
        if (!adminOk(request, env)) {
          return json({ error: 'Not authorised', detail: 'Send the admin token in the x-admin-token header.', statusCode: 401 }, 401, origin);
        }
        const log = await readJson(env, ORDERS_KEY, []);
        return json({ orders: Array.isArray(log) ? log : [], count: Array.isArray(log) ? log.length : 0 }, 200, origin);
      }

      if (method === 'POST') {
        if (!adminOk(request, env) && !storeKeyOk(request, env)) {
          return json({ error: 'Not authorised', detail: 'Send the store key (x-store-key) or the admin token (x-admin-token).', statusCode: 401 }, 401, origin);
        }
        if (!storeReady) {
          return json({ error: 'No storage attached', detail: 'The STORE_CONFIG KV binding is missing.', statusCode: 500 }, 500, origin);
        }
        let rec;
        try { rec = await request.json(); }
        catch (e) { return json({ error: 'Invalid JSON body', statusCode: 400 }, 400, origin); }
        if (!rec || !rec.id) {
          return json({ error: 'An order record needs its BusinessKoro id', statusCode: 400 }, 400, origin);
        }
        const log = await readJson(env, ORDERS_KEY, []);
        const list = Array.isArray(log) ? log : [];
        if (!list.some((o) => o && o.id === rec.id)) {
          const row = Object.assign({}, rec, {
            recordedAt: new Date().toISOString(),
            adminHidden: false,
          });
          list.unshift(row);
          await writeJson(env, ORDERS_KEY, list.slice(0, ORDERS_CAP));
        }
        return json({ ok: true, count: Math.min(list.length, ORDERS_CAP) }, 200, origin);
      }

      return json({ error: 'Method not allowed', allow: 'GET, POST', statusCode: 405 }, 405, origin);
    }

    if (/^\/orders\/[^/]+$/.test(path) && method === 'PATCH') {
      if (!adminOk(request, env)) {
        return json({ error: 'Not authorised', detail: 'Send the admin token in the x-admin-token header.', statusCode: 401 }, 401, origin);
      }
      const id = decodeURIComponent(path.slice('/orders/'.length));
      let patch;
      try { patch = await request.json(); }
      catch (e) { return json({ error: 'Invalid JSON body', statusCode: 400 }, 400, origin); }
      const log = await readJson(env, ORDERS_KEY, []);
      const list = Array.isArray(log) ? log : [];
      const row = list.filter((o) => o && o.id === id)[0];
      if (!row) return json({ error: 'No such order in the board', statusCode: 404 }, 404, origin);
      if (typeof patch.adminHidden === 'boolean') row.adminHidden = patch.adminHidden;
      if (typeof patch.adminNote === 'string') row.adminNote = patch.adminNote.slice(0, 400);
      if (typeof patch.status === 'string') row.status = patch.status.slice(0, 40);
      await writeJson(env, ORDERS_KEY, list);
      return json({ ok: true, order: row }, 200, origin);
    }

    return json({
      error: 'Not found',
      detail: 'Supported: GET /, PUT /, GET /orders, POST /orders, PATCH /orders/:id, GET /health',
      statusCode: 404,
    }, 404, origin);
  },
};
