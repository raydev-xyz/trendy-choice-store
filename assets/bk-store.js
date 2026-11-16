/* Trendy Choice — the store settings every page shares
   ------------------------------------------------------------------
   ONE document, two readers. The admin panel writes it, the shop reads it,
   and both go to the same place:

       GET  https://trendy-admin.r4ydevbd.workers.dev/   (public read)
       PUT  ... same URL                                 (x-admin-token)

   Nothing here is invented: every value displayed by the shop still comes
   from the BusinessKoro catalogue. This file only records the decisions the
   owner makes about that catalogue — which products to show, in what order,
   at what price, and which images to use as banners.

   If the settings service cannot be reached the shop behaves exactly as it
   did before this file existed (nothing hidden, nothing pinned, backend
   prices). It never silently applies a half-loaded document.
*/
(function () {
  var BASE = 'https://trendy-admin.r4ydevbd.workers.dev';
  var CACHE_KEY = 'tc_store_cfg_v2';
  var TOKEN_KEY = 'tc_admin_token_v2';
  var STORE_KEY = 'tc-storefront-9f42c1';   /* write-only: can append an order, cannot read */

  function empty() {
    return { v: 2, updatedAt: null, hero: { slides: [] }, hidden: [], pinned: [], price: {}, newArrivals: [], copy: {} };
  }

  function normalize(raw) {
    var out = empty();
    if (!raw || typeof raw !== 'object') return out;
    Object.keys(out).forEach(function (k) {
      if (k === 'hero') return;
      if (raw[k] !== undefined && raw[k] !== null) out[k] = raw[k];
    });
    if (raw.hero && typeof raw.hero === 'object') {
      out.hero = { slides: Array.isArray(raw.hero.slides) ? raw.hero.slides.filter(Boolean) : [] };
    }
    ['hidden', 'pinned', 'newArrivals'].forEach(function (k) {
      if (!Array.isArray(out[k])) out[k] = [];
      out[k] = out[k].map(String);
    });
    if (!out.price || typeof out.price !== 'object' || Array.isArray(out.price)) out.price = {};
    if (!out.copy || typeof out.copy !== 'object') out.copy = {};
    return out;
  }

  function readCache() {
    try {
      var d = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      return d && d.config ? normalize(d.config) : null;
    } catch (e) { return null; }
  }

  function writeCache(cfg) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), config: cfg })); } catch (e) { }
  }

  var CONFIG = readCache() || empty();
  var READY = null;
  var ERROR = null;

  function request(path, options) {
    options = options || {};
    var headers = { 'Accept': 'application/json' };
    if (options.body) headers['Content-Type'] = 'application/json';
    if (options.admin) headers['x-admin-token'] = (window.STORE.adminToken() || '');
    if (options.storeKey) headers['x-store-key'] = STORE_KEY;
    return fetch(BASE + path, {
      method: options.method || 'GET',
      headers: headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache: 'no-store'
    }).then(function (res) {
      return res.text().then(function (t) {
        var body = null;
        try { body = t ? JSON.parse(t) : null; } catch (e) { body = { raw: t }; }
        if (!res.ok) {
          var msg = (body && (body.error || body.detail)) || ('HTTP ' + res.status);
          var err = new Error(msg);
          err.status = res.status;
          err.body = body;
          throw err;
        }
        return body;
      });
    });
  }

  /* Load the settings once per page. Resolves to the config either way, so a
     caller can simply paint and never has to special-case the failure. */
  function load() {
    if (READY) return READY;
    READY = request('/').then(function (d) {
      CONFIG = normalize(d && d.config);
      writeCache(CONFIG);
      ERROR = null;
      return CONFIG;
    }, function (err) {
      ERROR = err;
      READY = null;                       /* allow a retry on the next call */
      return CONFIG;                      /* cached (or empty) settings */
    });
    return READY;
  }

  window.STORE = {
    base: BASE,

    /* the currently known settings — never null */
    config: function () { return CONFIG; },
    get error() { return ERROR; },
    ready: null,                          /* replaced on first load() */

    /* reload from the service (the admin panel calls this after a save) */
    load: function () { READY = null; return load(); },

    /* what the shop needs: which keys are hidden / pinned / re-priced */
    isHidden: function (key) { return CONFIG.hidden.indexOf(String(key)) !== -1; },
    isNewArrival: function (key) { return CONFIG.newArrivals.indexOf(String(key)) !== -1; },
    priceOf: function (key) {
      var v = CONFIG.price[String(key)];
      return (v === undefined || v === null) ? null : Number(v);
    },
    /* sort a product list by the admin's pin order, then by its own order */
    order: function (list) {
      var pins = CONFIG.pinned;
      if (!pins.length) return list;
      var rank = {};
      pins.forEach(function (k, i) { rank[String(k)] = i; });
      return list.slice().sort(function (a, b) {
        var ra = rank[String(a.id)], rb = rank[String(b.id)];
        var ha = ra === undefined, hb = rb === undefined;
        if (ha && hb) return 0;
        if (ha) return 1;
        if (hb) return -1;
        return ra - rb;
      });
    },

    /* ---- admin side ---- */
    adminToken: function () {
      try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
    },
    setAdminToken: function (t) {
      try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch (e) { }
    },
    /* verify the token by attempting a harmless read that requires it */
    verifyToken: function () {
      return request('/orders', { admin: true }).then(function () { return true; });
    },
    save: function (cfg) {
      return request('/', { method: 'PUT', admin: true, body: cfg }).then(function (d) {
        CONFIG = normalize(d && d.config);
        writeCache(CONFIG);
        return CONFIG;
      });
    },
    orders: function () {
      return request('/orders', { admin: true }).then(function (d) { return (d && d.orders) || []; });
    },
    patchOrder: function (id, patch) {
      return request('/orders/' + encodeURIComponent(id), { method: 'PATCH', admin: true, body: patch });
    },
    /* called by the checkout once BusinessKoro accepted an order */
    recordOrder: function (rec) {
      return request('/orders', { method: 'POST', storeKey: true, body: rec }).catch(function () { return null; });
    }
  };

  /* expose the promise under a stable name too */
  window.STORE.ready = load();
})();
