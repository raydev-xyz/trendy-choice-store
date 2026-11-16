/* Trendy Choice — the store settings every page shares
   ------------------------------------------------------------------
   ONE document, two readers. The admin panel writes it, the shop reads it,
   and both go to the same place:

       GET  https://trendy-admin.r4ydevbd.workers.dev/config   (public read)
       PUT  ... same URL                                      (session token)

   Nothing here is invented: every product, price and stock figure still comes
   from the BusinessKoro catalogue. This file only records the decisions the
   owner makes about that catalogue — which products to show, in what order, at
   what price, which images act as banners, and what the delivery charge is.

   If the settings service cannot be reached the shop behaves exactly as it did
   before this file existed (nothing hidden, nothing pinned, backend prices,
   published delivery rates). It never silently applies a half-loaded document.

   Session model: the panel exchanges username+password for a bearer token and
   keeps it in localStorage under TOKEN_KEY. The token is sent as
   `Authorization: Bearer …`; there is no shared password in this file.
*/
(function () {
  var BASE = 'https://trendy-admin.r4ydevbd.workers.dev';
  var CACHE_KEY = 'tc_store_cfg_v3';
  var TOKEN_KEY = 'tc_admin_sess_v3';
  var USER_KEY = 'tc_admin_user_v3';
  var SESSION_MINUTES = 60;
  var STORE_KEY = 'tc-storefront-9f42c1';   /* write-only: appends an order, reads nothing */

  function defaultShipping() { return { insideDhaka: 70, outsideDhaka: 130, freeAbove: 0 }; }

  function empty() {
    return {
      v: 3, updatedAt: null,
      hero: { slides: [] },
      hidden: [], pinned: [], price: {}, newArrivals: [], copy: {},
      shipping: defaultShipping(),
      flashSale: { active: false, label: '', endsAt: '', percent: 0, ids: [] },
      notifications: { sms: '', email: '', status: '' },
      announcement: '', maintenance: false
    };
  }

  function normalize(raw) {
    var out = empty();
    if (!raw || typeof raw !== 'object') return out;
    Object.keys(out).forEach(function (k) {
      if (k === 'hero' || k === 'shipping') return;
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
    var sh = raw.shipping || {};
    out.shipping = {
      insideDhaka: Number(sh.insideDhaka) > 0 ? Math.round(Number(sh.insideDhaka)) : 70,
      outsideDhaka: Number(sh.outsideDhaka) > 0 ? Math.round(Number(sh.outsideDhaka)) : 130,
      freeAbove: Number(sh.freeAbove) > 0 ? Math.round(Number(sh.freeAbove)) : 0
    };
    out.announcement = typeof out.announcement === 'string' ? out.announcement : '';
    out.maintenance = !!out.maintenance;
    var f = raw.flashSale || {};
    out.flashSale = {
      active: !!f.active,
      label: typeof f.label === 'string' ? f.label.slice(0, 60) : '',
      endsAt: typeof f.endsAt === 'string' ? f.endsAt : '',
      percent: Number(f.percent) > 0 ? Math.min(90, Math.round(Number(f.percent))) : 0,
      ids: Array.isArray(f.ids) ? f.ids.map(String) : []
    };
    var n = raw.notifications || {};
    out.notifications = {
      sms: typeof n.sms === 'string' ? n.sms.slice(0, 400) : '',
      email: typeof n.email === 'string' ? n.email.slice(0, 800) : '',
      status: typeof n.status === 'string' ? n.status.slice(0, 400) : ''
    };
    return out;
  }

  /* ---------------- session ---------------- */

  function readSession() {
    try {
      var d = JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null');
      if (!d || !d.token) return null;
      if (d.until && Date.now() > d.until) { clearSession(); return null; }
      return d;
    } catch (e) { return null; }
  }

  function writeSession(token, user) {
    var s = { token: token, user: user || null, until: Date.now() + SESSION_MINUTES * 60e3 };
    try { localStorage.setItem(TOKEN_KEY, JSON.stringify(s)); } catch (e) {}
    try { localStorage.setItem(USER_KEY, JSON.stringify(user || null)); } catch (e) {}
  }

  function clearSession() {
    try { localStorage.removeItem(TOKEN_KEY); } catch (e) {}
    try { localStorage.removeItem(USER_KEY); } catch (e) {}
  }

  /* every authenticated call pushes the expiry forward, mirroring the
     Worker's own idle timeout */
  function touch() {
    var s = readSession();
    if (!s) return;
    s.until = Date.now() + SESSION_MINUTES * 60e3;
    try { localStorage.setItem(TOKEN_KEY, JSON.stringify(s)); } catch (e) {}
  }

  function readCache() {
    try {
      var d = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      return d && d.config ? normalize(d.config) : null;
    } catch (e) { return null; }
  }

  function writeCache(cfg) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), config: cfg })); } catch (e) {}
  }

  var CONFIG = readCache() || empty();
  var OVERRIDES = {};
  var READY = null;
  var ERROR = null;

  function request(path, options) {
    options = options || {};
    var headers = { 'Accept': 'application/json' };
    if (options.body) headers['Content-Type'] = 'application/json';
    if (options.storeKey) headers['x-store-key'] = STORE_KEY;
    else if (options.auth !== false) {
      var s = readSession();
      if (s && s.token) headers['Authorization'] = 'Bearer ' + s.token;
    }
    return fetch(BASE + path, {
      method: options.method || 'GET',
      headers: headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache: 'no-store'
    }).then(function (res) {
      return res.text().then(function (t) {
        var body = null;
        try { body = t ? JSON.parse(t) : null; } catch (e) { body = { raw: t }; }
        if (res.status === 401) {
          var msg = (body && (body.error || body.detail)) || 'Not signed in.';
          var e401 = new Error(msg);
          e401.status = 401;
          e401.body = body;
          e401.unauthorised = true;
          throw e401;
        }
        if (!res.ok) {
          var m = (body && (body.error || body.detail)) || ('HTTP ' + res.status);
          var err = new Error(m);
          err.status = res.status;
          err.body = body;
          throw err;
        }
        touch();
        return body;
      });
    });
  }

  /* Load the settings once per page. Resolves to the config either way, so a
     caller can simply paint and never has to special-case the failure. */
  function load() {
    if (READY) return READY;
    READY = request('/config', { auth: false }).then(function (d) {
      CONFIG = normalize(d && d.config);
      OVERRIDES = (d && d.overrides && typeof d.overrides === 'object') ? d.overrides : {};
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

    config: function () { return CONFIG; },
    get error() { return ERROR; },
    ready: null,                          /* replaced on first load() */

    load: function () { READY = null; return load(); },

    /* the owner's published delivery rates — the shop and the checkout both
       read them here, so a change in the panel moves the real charge */
    shipping: function () {
      return CONFIG.shipping || defaultShipping();
    },
    announcement: function () { return CONFIG.announcement || ''; },
    maintenance: function () { return !!CONFIG.maintenance; },

    isHidden: function (key) { return CONFIG.hidden.indexOf(String(key)) !== -1; },
    flashSale: function () { return CONFIG.flashSale; },
    notifications: function () { return CONFIG.notifications; },
    /* the owner's per-product edits, keyed by the same id the shop uses */
    overrides: function () { return OVERRIDES; },
    overrideFor: function (key) {
      var o = OVERRIDES[String(key)];
      return (o && typeof o === 'object') ? o : null;
    },
    isNewArrival: function (key) { return CONFIG.newArrivals.indexOf(String(key)) !== -1; },
    isPinned: function (key) { return CONFIG.pinned.indexOf(String(key)) !== -1; },
    priceOf: function (key) {
      var v = CONFIG.price[String(key)];
      return (v === undefined || v === null) ? null : Number(v);
    },
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

    /* ---- session ---- */
    session: function () { return readSession(); },
    user: function () {
      var s = readSession();
      return (s && s.user) || null;
    },
    signedIn: function () { return !!readSession(); },
    signOut: function () {
      var s = readSession();
      if (s && s.token) request('/auth/logout', { method: 'POST' }).catch(function () {});
      clearSession();
    },

    /* password -> token. The password itself is never stored. */
    signIn: function (username, password) {
      return request('/auth/login', {
        method: 'POST', auth: false, body: { username: username, password: password }
      }).then(function (d) {
        if (!d || !d.token) throw new Error('The service did not return a session token.');
        writeSession(d.token, d.user);
        return d.user || null;
      });
    },

    changePassword: function (oldPassword, newPassword) {
      return request('/auth/password', {
        method: 'POST', body: { oldPassword: oldPassword, newPassword: newPassword }
      });
    },

    /* locked out? the owner's reset key sets a new password without a session */
    resetPassword: function (resetKey, newPassword, username) {
      return request('/auth/reset', {
        method: 'POST', auth: false,
        body: { resetKey: resetKey, newPassword: newPassword, username: username || 'admin' }
      });
    },

    /* ---- panel reads/writes ---- */
    bootstrap: function () { return request('/bootstrap'); },
    saveConfig: function (cfg) {
      return request('/config', { method: 'PUT', body: { config: cfg } }).then(function (d) {
        CONFIG = normalize(d && d.config);
        writeCache(CONFIG);
        return CONFIG;
      });
    },
    saveOverrides: function (map) {
      return request('/product-overrides', { method: 'PUT', body: { overrides: map } });
    },
    orders: function () { return request('/orders').then(function (d) { return (d && d.orders) || []; }); },
    patchOrder: function (id, patch) {
      return request('/orders/' + encodeURIComponent(id), { method: 'PATCH', body: patch });
    },
    deleteOrder: function (id) {
      return request('/orders/' + encodeURIComponent(id), { method: 'DELETE' });
    },
    saveSettings: function (s) { return request('/settings', { method: 'PUT', body: { settings: s } }); },
    savePages: function (p) { return request('/pages', { method: 'PUT', body: { pages: p } }); },
    addCoupon: function (c) { return request('/coupons', { method: 'POST', body: c }); },
    patchCoupon: function (id, patch) {
      return request('/coupons/' + encodeURIComponent(id), { method: 'PATCH', body: patch });
    },
    deleteCoupon: function (id) {
      return request('/coupons/' + encodeURIComponent(id), { method: 'DELETE' });
    },
    addReview: function (r) { return request('/reviews', { method: 'POST', body: r }); },
    patchReview: function (id, patch) {
      return request('/reviews/' + encodeURIComponent(id), { method: 'PATCH', body: patch });
    },
    deleteReview: function (id) {
      return request('/reviews/' + encodeURIComponent(id), { method: 'DELETE' });
    },
    addUser: function (u) { return request('/users', { method: 'POST', body: u }); },
    patchUser: function (id, patch) {
      return request('/users/' + encodeURIComponent(id), { method: 'PATCH', body: patch });
    },
    deleteUser: function (id) {
      return request('/users/' + encodeURIComponent(id), { method: 'DELETE' });
    },
    addSupplier: function (s) { return request('/suppliers', { method: 'POST', body: s }); },
    deleteSupplier: function (id) {
      return request('/suppliers/' + encodeURIComponent(id), { method: 'DELETE' });
    },
    addMovement: function (m) { return request('/inventory', { method: 'POST', body: m }); },
    patchCustomer: function (key, patch) {
      return request('/customers/' + encodeURIComponent(key), { method: 'PATCH', body: patch });
    },
    report: function (from, to) {
      var q = [];
      if (from) q.push('from=' + encodeURIComponent(from));
      if (to) q.push('to=' + encodeURIComponent(to));
      return request('/reports' + (q.length ? '?' + q.join('&') : '')).then(function (d) {
        return (d && d.report) || null;
      });
    },

    /* called by the checkout once BusinessKoro accepted an order — the write
       is fire-and-forget so a hiccup here never loses the real order */
    recordOrder: function (rec) {
      return request('/orders', { method: 'POST', storeKey: true, body: rec })
        .catch(function () { return null; });
    }
  };

  window.STORE.ready = load();
})();
