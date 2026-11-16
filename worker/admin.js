/**
 * Trendy Choice — store backend (Cloudflare Worker, v3)
 * -----------------------------------------------------------------
 * ONE service, two clients:
 *   - the shop    : public read of the settings document, append an order
 *   - the admin   : everything else, behind a session token
 *
 * `worker/worker.js` (the BusinessKoro proxy at trendy.r4ydevbd.workers.dev)
 * is left untouched — it keeps serving the catalogue and forwarding orders.
 * This Worker stores every decision the owner makes, in the STORE_CONFIG KV
 * namespace, one key per collection, so the shop and the panel read the SAME
 * document. A change saved in the panel is what the shop shows on its next
 * page load.
 *
 * Environment (Cloudflare secrets / bindings, never in git)
 *   ADMIN_TOKEN  (Secret)  bootstrap password for the first super admin
 *   STORE_KEY    (Secret)  write-only key the storefront uses to append orders
 *   STORE_CONFIG (KV)      every document
 *
 * Design rules honoured here
 *   - No mock data. Every figure returned is computed from stored rows.
 *   - Authorisation is enforced on the SERVER for every write; the panel
 *     hiding a button is a convenience, never the control.
 *   - Passwords are PBKDF2-SHA256 (150k rounds, per-user salt). A hash or a
 *     salt never leaves this Worker.
 *   - Every write is appended to the activity log with who / when / what.
 */

const ALLOWED_ORIGINS = [
  'https://raydev-xyz.github.io',
  'https://static.teamily.ai',
  'https://teamily.ai',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
];

const K = {
  config: 'store-config',
  orders: 'order-log',
  users: 'admin-users',
  sessions: 'admin-sessions',
  activity: 'activity-log',
  products: 'product-overrides',
  coupons: 'coupons',
  settings: 'store-settings',
  pages: 'content-pages',
  reviews: 'reviews',
  customers: 'customer-flags',
  inventory: 'inventory-log',
  suppliers: 'suppliers',
};

const ORDERS_CAP = 500;
const ACTIVITY_CAP = 400;
const SESSION_HOURS = 12;
const IDLE_MINUTES = 60;
const ROLES = ['super', 'manager', 'staff'];
const STATUSES = ['Pending', 'Confirmed', 'Processing', 'Shipped', 'Delivered', 'Cancelled', 'Returned'];

/* Which role may touch which area. `staff` is deliberately read-mostly: it can
   move an order along, nothing else. */
const CAN = {
  config: ['super', 'manager'],
  products: ['super', 'manager'],
  marketing: ['super', 'manager'],
  content: ['super', 'manager'],
  reports: ['super', 'manager'],
  settings: ['super'],
  users: ['super'],
  inventory: ['super', 'manager'],
  orders: ['super', 'manager', 'staff'],
  customers: ['super', 'manager', 'staff'],
};

/* ------------------------------------------------------------------ utils */

function cors(origin) {
  const allow = !origin ? '*'
    : (ALLOWED_ORIGINS.indexOf(origin) !== -1 ? origin : ALLOWED_ORIGINS[0]);
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Accept,x-admin-token,x-store-key,Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: Object.assign(
      { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      cors(origin)
    ),
  });
}

function bad(msg, status, origin, extra) {
  return json(Object.assign({ error: msg, statusCode: status || 400 }, extra || {}), status || 400, origin);
}

async function readJson(env, key, fallback) {
  if (!env.STORE_CONFIG) return fallback;
  try {
    const v = await env.STORE_CONFIG.get(key, 'json');
    return v == null ? fallback : v;
  } catch (e) { return fallback; }
}

async function writeJson(env, key, value) {
  if (!env.STORE_CONFIG) throw new Error('STORE_CONFIG KV binding is missing');
  await env.STORE_CONFIG.put(key, JSON.stringify(value));
}

function hex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomHex(bytes) {
  const a = new Uint8Array(bytes || 16);
  crypto.getRandomValues(a);
  return hex(a);
}

async function pbkdf2(password, saltHex, iterations) {
  const salt = new Uint8Array(saltHex.match(/.{2}/g).map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: iterations || 100000, hash: 'SHA-256' }, key, 256
  );
  return hex(bits);
}

async function hashPassword(password) {
  const salt = randomHex(16);
  return { salt, iterations: 100000, hash: await pbkdf2(password, salt, 100000) };
}

function safeEqual(a, b) {
  a = String(a || ''); b = String(b || '');
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function nowIso() { return new Date().toISOString(); }

/* ------------------------------------------------------------ documents */

function emptyConfig() {
  return {
    v: 3,
    updatedAt: null,
    hero: { slides: [] },
    hidden: [],
    pinned: [],
    price: {},
    newArrivals: [],
    copy: {},
    shipping: { insideDhaka: 70, outsideDhaka: 130, freeAbove: 0 },
    announcement: '',
    maintenance: false,
  };
}

function normalize(raw) {
  const out = Object.assign(emptyConfig(), raw && typeof raw === 'object' ? raw : {});
  out.hero = Object.assign({ slides: [] }, (raw && raw.hero) || {});
  if (!Array.isArray(out.hero.slides)) out.hero.slides = [];
  out.hero.slides = out.hero.slides.filter((s) => typeof s === 'string' && s);
  ['hidden', 'pinned', 'newArrivals'].forEach((k) => {
    if (!Array.isArray(out[k])) out[k] = [];
    out[k] = out[k].map(String).filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);
  });
  if (!out.price || typeof out.price !== 'object' || Array.isArray(out.price)) out.price = {};
  const price = {};
  Object.keys(out.price).forEach((k) => {
    const n = Number(out.price[k]);
    if (isFinite(n) && n > 0) price[k] = Math.round(n);
  });
  out.price = price;
  if (!out.copy || typeof out.copy !== 'object' || Array.isArray(out.copy)) out.copy = {};
  const sh = out.shipping || {};
  out.shipping = {
    insideDhaka: Number(sh.insideDhaka) > 0 ? Math.round(Number(sh.insideDhaka)) : 70,
    outsideDhaka: Number(sh.outsideDhaka) > 0 ? Math.round(Number(sh.outsideDhaka)) : 130,
    freeAbove: Number(sh.freeAbove) > 0 ? Math.round(Number(sh.freeAbove)) : 0,
  };
  out.announcement = typeof out.announcement === 'string' ? out.announcement.slice(0, 200) : '';
  out.maintenance = !!out.maintenance;
  out.v = 3;
  return out;
}

function defaultSettings() {
  return {
    v: 1,
    updatedAt: null,
    storeName: 'Trendy Choice',
    tagline: 'shop smart, live trendy.',
    logo: '',
    phone: '+8809642922922',
    whatsapp: '+8801826459122',
    email: '',
    address: 'Dhaka, Bangladesh',
    currency: 'BDT',
    currencySymbol: '\u09F3',
    taxPercent: 0,
    lowStockThreshold: 5,
    seo: { title: '', description: '', keywords: '', image: '' },
    social: { facebook: '', instagram: '', tiktok: '', youtube: '' },
    notifications: {
      orderEmail: '',
      smsTemplate: 'Trendy Choice: order #{order} confirmed. Total {total}. We will call you shortly.',
      emailTemplate: 'Thank you for shopping with Trendy Choice. Order #{order} ({total}) received.',
    },
    payment: { bKash: true, Nagad: true, Rocket: true, Upay: true, COD: true, Card: false, payNumber: '01893197649' },
    maintenance: { enabled: false, message: 'We are restocking the shelves. Back in a little while.' },
  };
}

function normSettings(raw) {
  const d = defaultSettings();
  const out = Object.assign(d, raw && typeof raw === 'object' ? raw : {});
  ['seo', 'social', 'notifications', 'payment', 'maintenance'].forEach((k) => {
    out[k] = Object.assign({}, d[k], (raw && raw[k]) || {});
  });
  ['taxPercent', 'lowStockThreshold'].forEach((k) => {
    const n = Number(out[k]);
    out[k] = isFinite(n) && n >= 0 ? n : d[k];
  });
  out.v = 1;
  return out;
}

/* ------------------------------------------------------------- sessions */

async function loadSessions(env) {
  const s = await readJson(env, K.sessions, {});
  return s && typeof s === 'object' ? s : {};
}

async function currentUser(request, env) {
  const h = request.headers.get('Authorization') || '';
  const token = h.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const sessions = await loadSessions(env);
  const s = sessions[token];
  if (!s) return null;
  const now = Date.now();
  const created = Date.parse(s.createdAt) || 0;
  const seen = Date.parse(s.lastSeen) || created;
  if (now - created > SESSION_HOURS * 3600e3 || now - seen > IDLE_MINUTES * 60e3) {
    delete sessions[token];
    await writeJson(env, K.sessions, sessions).catch(() => {});
    return null;
  }
  s.lastSeen = nowIso();
  sessions[token] = s;
  await writeJson(env, K.sessions, sessions).catch(() => {});
  return { token, username: s.username, role: s.role, name: s.name };
}

function may(user, area) {
  if (!user) return false;
  const list = CAN[area];
  return !!list && list.indexOf(user.role) !== -1;
}

async function logActivity(env, user, action, detail) {
  const log = await readJson(env, K.activity, []);
  const list = Array.isArray(log) ? log : [];
  list.unshift({
    at: nowIso(),
    by: user ? user.username : 'system',
    role: user ? user.role : '-',
    action: String(action || '').slice(0, 60),
    detail: String(detail || '').slice(0, 300),
  });
  await writeJson(env, K.activity, list.slice(0, ACTIVITY_CAP)).catch(() => {});
}

/* ---------------------------------------------------------------- users */

async function loadUsers(env) {
  const list = await readJson(env, K.users, null);
  return Array.isArray(list) ? list : null;
}

/* Before any account exists, ADMIN_TOKEN is the bootstrap password for a
   single `admin` super account. It is hashed on first use and never stored. */
async function ensureBootstrap(env) {
  let users = await loadUsers(env);
  if (users && users.length) return users;
  const pass = (env.ADMIN_TOKEN || '').trim();
  if (!pass) return null;
  const h = await hashPassword(pass);
  users = [{
    id: 'u-' + randomHex(4),
    username: 'admin',
    name: 'Store owner',
    role: 'super',
    active: true,
    salt: h.salt,
    iterations: h.iterations,
    hash: h.hash,
    createdAt: nowIso(),
    lastLogin: null,
    mustChange: false,
  }];
  await writeJson(env, K.users, users);
  return users;
}

function publicUser(u) {
  return {
    id: u.id, username: u.username, name: u.name, role: u.role,
    active: u.active !== false, createdAt: u.createdAt,
    lastLogin: u.lastLogin || null, mustChange: !!u.mustChange,
  };
}

/* ---------------------------------------------------------------- orders */

function orderRevenue(o) {
  if (!o) return 0;
  if (o.status === 'Cancelled' || o.status === 'Returned') return 0;
  return (Number(o.sellingPrice) || 0) + (Number(o.deliveryCharge) || 0);
}

/* ------------------------------------------------------------ customers */

function customersFrom(orders, flags) {
  const byPhone = {};
  const flagsBy = flags && typeof flags === 'object' ? flags : {};
  (orders || []).forEach((o) => {
    const key = String(o.customerPhone || o.customerName || o.id || '').trim();
    if (!key) return;
    if (!byPhone[key]) {
      byPhone[key] = {
        key,
        name: o.customerName || '',
        phone: o.customerPhone || '',
        address: [o.customerArea, o.customerDistrict, o.customerAddress].filter(Boolean).join(', '),
        orders: 0, spent: 0,
        firstOrder: o.recordedAt || o.placedAt || null,
        lastOrder: o.recordedAt || o.placedAt || null,
      };
    }
    const c = byPhone[key];
    c.orders += 1;
    c.spent += orderRevenue(o);
    const at = o.recordedAt || o.placedAt || '';
    if (at && (!c.lastOrder || at > c.lastOrder)) c.lastOrder = at;
    if (at && (!c.firstOrder || at < c.firstOrder)) c.firstOrder = at;
    if (!c.phone && o.customerPhone) c.phone = o.customerPhone;
  });
  return Object.keys(byPhone).map((k) => {
    const c = byPhone[k];
    const f = flagsBy[k] || {};
    c.blocked = !!f.blocked;
    c.note = f.note || '';
    return c;
  }).sort((a, b) => (String(a.lastOrder) < String(b.lastOrder) ? 1 : -1));
}

/* ---------------------------------------------------------------- reports */

function dayOf(o) {
  return String((o && (o.recordedAt || o.placedAt)) || '').slice(0, 10);
}

function buildReport(orders, from, to) {
  const rows = (orders || []).filter((o) => {
    const d = dayOf(o);
    if (!d) return false;
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  });
  const dayMap = {}, prodMap = {}, statusMap = {}, customers = {};
  let revenue = 0, cancelled = 0;
  rows.forEach((o) => {
    const d = dayOf(o);
    const rev = orderRevenue(o);
    revenue += rev;
    if (o.status === 'Cancelled' || o.status === 'Returned') cancelled += 1;
    if (!dayMap[d]) dayMap[d] = { date: d, orders: 0, revenue: 0 };
    dayMap[d].orders += 1;
    dayMap[d].revenue += rev;
    const pn = o.productName || '(unnamed)';
    if (!prodMap[pn]) prodMap[pn] = { name: pn, qty: 0, revenue: 0 };
    prodMap[pn].qty += Number(o.quantity) || 1;
    prodMap[pn].revenue += rev;
    statusMap[o.status || 'Pending'] = (statusMap[o.status || 'Pending'] || 0) + 1;
    customers[o.customerPhone || o.customerName || '?'] = 1;
  });
  return {
    from: from || null,
    to: to || null,
    totals: {
      orders: rows.length, revenue, cancelled,
      customers: Object.keys(customers).length,
      average: rows.length ? Math.round(revenue / rows.length) : 0,
    },
    byDay: Object.keys(dayMap).sort().map((k) => dayMap[k]),
    byProduct: Object.keys(prodMap).map((k) => prodMap[k]).sort((a, b) => b.revenue - a.revenue),
    byStatus: statusMap,
  };
}

/* ------------------------------------------------------------------ main */

/* Cloudflare turns any uncaught throw into an opaque 1101 page. Everything
   below runs inside this wrapper so a failure comes back as JSON that names
   the actual problem instead of an error code the caller cannot act on. */
async function handle(request, env) {
    const origin = request.headers.get('Origin') || '';
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = request.method;

    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });

    if (path === '/health') {
      return json({
        ok: true, worker: 'tc-store-config', version: 3,
        admin_configured: !!env.ADMIN_TOKEN,
        store_key_configured: !!env.STORE_KEY,
        config_store: !!env.STORE_CONFIG,
      }, 200, origin);
    }

    /* ------------------------------------------------ auth */

    if (path === '/auth/login' && method === 'POST') {
      let body;
      try { body = await request.json(); } catch (e) { return bad('Invalid JSON body', 400, origin); }
      const username = String((body && body.username) || '').trim().toLowerCase();
      const password = String((body && body.password) || '');
      if (!username || !password) return bad('Username and password are required.', 400, origin);

      const users = await ensureBootstrap(env);
      if (!users) return bad('No admin account exists yet and ADMIN_TOKEN is not set on this Worker.', 500, origin);

      const user = users.filter((u) => String(u.username).toLowerCase() === username)[0];
      if (!user) return bad('Wrong username or password.', 401, origin);
      if (user.active === false) return bad('This account has been blocked.', 403, origin);

      const attempt = await pbkdf2(password, user.salt, user.iterations || 100000);
      if (!safeEqual(attempt, user.hash)) {
        await logActivity(env, { username, role: '-' }, 'login_failed', 'wrong password for ' + username);
        return bad('Wrong username or password.', 401, origin);
      }

      user.lastLogin = nowIso();
      await writeJson(env, K.users, users);

      const token = randomHex(24);
      const sessions = await loadSessions(env);
      Object.keys(sessions).forEach((t) => {
        const s = sessions[t];
        if (!s || Date.parse(s.createdAt) < Date.now() - SESSION_HOURS * 3600e3) delete sessions[t];
      });
      sessions[token] = {
        username: user.username, role: user.role, name: user.name,
        createdAt: nowIso(), lastSeen: nowIso(),
      };
      await writeJson(env, K.sessions, sessions);
      await logActivity(env, { username: user.username, role: user.role }, 'login', 'signed in');

      return json({ ok: true, token, expiresInMinutes: IDLE_MINUTES, user: publicUser(user) }, 200, origin);
    }

    if (path === '/auth/logout' && method === 'POST') {
      const who = await currentUser(request, env);
      if (who) {
        const sessions = await loadSessions(env);
        delete sessions[who.token];
        await writeJson(env, K.sessions, sessions);
        await logActivity(env, who, 'logout', 'signed out');
      }
      return json({ ok: true }, 200, origin);
    }

    if (path === '/me' && method === 'GET') {
      const who = await currentUser(request, env);
      if (!who) return bad('Not signed in.', 401, origin);
      return json({ ok: true, user: { username: who.username, role: who.role, name: who.name } }, 200, origin);
    }

    /* --------------------------- public storefront read --------------------------- */

    if ((path === '/' || path === '/config') && method === 'GET') {
      const stored = await readJson(env, K.config, null);
      const settings = await readJson(env, K.settings, null);
      /* the product edits travel with the storefront document: the shop needs
         them to paint the same names, prices and photos the panel shows, and
         they contain nothing the shop does not already display */
      const overrides = await readJson(env, K.products, {});
      return json({
        config: normalize(stored),
        settings: normSettings(settings),
        overrides: overrides && typeof overrides === 'object' ? overrides : {},
        source: stored ? 'kv' : 'default',
        store: !!env.STORE_CONFIG,
      }, 200, origin);
    }

    /* The storefront appends an order with the write-only store key, so the
       checkout can record an order without shipping the admin password to the
       browser. That key can write one row and read nothing. */
    if (path === '/orders' && method === 'POST') {
      const storeKeyOk = safeEqual(request.headers.get('x-store-key') || '', env.STORE_KEY || '');
      const who = storeKeyOk ? null : await currentUser(request, env);
      if (!storeKeyOk && !(who && may(who, 'orders'))) return bad('Not authorised.', 401, origin);

      let rec;
      try { rec = await request.json(); } catch (e) { return bad('Invalid JSON body', 400, origin); }
      if (!rec || !rec.id) return bad('An order record needs its BusinessKoro id.', 400, origin);

      const log = await readJson(env, K.orders, []);
      const list = Array.isArray(log) ? log : [];
      if (!list.some((o) => o && o.id === rec.id)) {
        list.unshift(Object.assign({}, rec, {
          recordedAt: nowIso(),
          adminHidden: false,
          status: rec.status || 'Pending',
          statusHistory: [{ at: nowIso(), status: rec.status || 'Pending', by: 'store' }],
        }));
        await writeJson(env, K.orders, list.slice(0, ORDERS_CAP));
      }
      if (who) await logActivity(env, who, 'order_create', rec.orderNumber || rec.id);
      return json({ ok: true, count: Math.min(list.length, ORDERS_CAP) }, 200, origin);
    }

    /* --------------------------- everything else needs a session --------------------------- */

    const me = await currentUser(request, env);
    if (!me) return bad('Not signed in.', 401, origin);

    if (path === '/auth/password' && method === 'POST') {
      let body;
      try { body = await request.json(); } catch (e) { return bad('Invalid JSON body', 400, origin); }
      const oldPass = String((body && body.oldPassword) || '');
      const newPass = String((body && body.newPassword) || '');
      if (newPass.length < 8) return bad('The new password must be at least 8 characters.', 400, origin);
      const users = await loadUsers(env);
      const user = (users || []).filter((u) => u.username === me.username)[0];
      if (!user) return bad('Account not found.', 404, origin);
      const attempt = await pbkdf2(oldPass, user.salt, user.iterations || 100000);
      if (!safeEqual(attempt, user.hash)) return bad('Your current password is wrong.', 401, origin);
      const h = await hashPassword(newPass);
      user.salt = h.salt; user.iterations = h.iterations; user.hash = h.hash; user.mustChange = false;
      await writeJson(env, K.users, users);
      await logActivity(env, me, 'password_change', 'changed own password');
      return json({ ok: true }, 200, origin);
    }

    /* one call, everything the panel renders — saves the panel eight round trips */
    if (path === '/bootstrap' && method === 'GET') {
      const users = await ensureBootstrap(env);
      const [config, orders, overrides, coupons, settings, pages, reviews, flags, inventory, suppliers, activity] =
        await Promise.all([
          readJson(env, K.config, null), readJson(env, K.orders, []),
          readJson(env, K.products, {}), readJson(env, K.coupons, []),
          readJson(env, K.settings, null), readJson(env, K.pages, {}),
          readJson(env, K.reviews, []), readJson(env, K.customers, {}),
          readJson(env, K.inventory, []), readJson(env, K.suppliers, []),
          readJson(env, K.activity, []),
        ]);
      const orderList = Array.isArray(orders) ? orders : [];
      const can = {};
      Object.keys(CAN).forEach((k) => { can[k] = may(me, k); });
      return json({
        ok: true,
        me: { username: me.username, role: me.role, name: me.name },
        can,
        config: normalize(config),
        orders: orderList,
        overrides: overrides && typeof overrides === 'object' ? overrides : {},
        coupons: Array.isArray(coupons) ? coupons : [],
        settings: normSettings(settings),
        pages: pages && typeof pages === 'object' ? pages : {},
        reviews: Array.isArray(reviews) ? reviews : [],
        customers: customersFrom(orderList, flags),
        inventory: Array.isArray(inventory) ? inventory : [],
        suppliers: Array.isArray(suppliers) ? suppliers : [],
        activity: Array.isArray(activity) ? activity.slice(0, 150) : [],
        users: (users || []).map(publicUser),
        statuses: STATUSES,
        roles: ROLES,
      }, 200, origin);
    }

    /* --------------------------- storefront config --------------------------- */

    if (path === '/config' && (method === 'PUT' || method === 'POST')) {
      if (!may(me, 'config')) return bad('Your role cannot change the storefront.', 403, origin);
      let body;
      try { body = await request.json(); } catch (e) { return bad('Invalid JSON body', 400, origin); }
      const next = normalize(body && body.config ? body.config : body);
      next.updatedAt = nowIso();
      await writeJson(env, K.config, next);
      await logActivity(env, me, 'config_save', 'storefront settings updated');
      return json({ ok: true, config: next }, 200, origin);
    }

    /* --------------------------- orders --------------------------- */

    if (path === '/orders' && method === 'GET') {
      if (!may(me, 'orders')) return bad('Not authorised.', 403, origin);
      const log = await readJson(env, K.orders, []);
      const list = Array.isArray(log) ? log : [];
      return json({ orders: list, count: list.length, statuses: STATUSES }, 200, origin);
    }

    if (/^\/orders\/[^/]+$/.test(path) && (method === 'PATCH' || method === 'DELETE')) {
      if (!may(me, 'orders')) return bad('Not authorised.', 403, origin);
      const id = decodeURIComponent(path.slice('/orders/'.length));
      const log = await readJson(env, K.orders, []);
      const list = Array.isArray(log) ? log : [];
      const idx = list.findIndex((o) => o && o.id === id);
      if (idx === -1) return bad('No such order in the board.', 404, origin);

      if (method === 'DELETE') {
        if (me.role !== 'super') return bad('Only a super admin can delete an order.', 403, origin);
        const gone = list.splice(idx, 1)[0];
        await writeJson(env, K.orders, list);
        await logActivity(env, me, 'order_delete', (gone && gone.orderNumber) || id);
        return json({ ok: true }, 200, origin);
      }

      let patch;
      try { patch = await request.json(); } catch (e) { return bad('Invalid JSON body', 400, origin); }
      const row = list[idx];
      if (typeof patch.adminHidden === 'boolean') row.adminHidden = patch.adminHidden;
      if (typeof patch.adminNote === 'string') row.adminNote = patch.adminNote.slice(0, 500);
      if (typeof patch.courierName === 'string') row.courierName = patch.courierName.slice(0, 60);
      if (typeof patch.trackingId === 'string') row.trackingId = patch.trackingId.slice(0, 60);
      if (typeof patch.refunded === 'boolean') row.refunded = patch.refunded;
      if (typeof patch.paymentVerified === 'boolean') row.paymentVerified = patch.paymentVerified;
      if (typeof patch.status === 'string') {
        const s = patch.status.slice(0, 30);
        if (STATUSES.indexOf(s) === -1) return bad('Unknown status: ' + s, 400, origin);
        row.status = s;
        row.statusHistory = Array.isArray(row.statusHistory) ? row.statusHistory : [];
        row.statusHistory.push({ at: nowIso(), status: s, by: me.username });
      }
      await writeJson(env, K.orders, list);
      await logActivity(env, me, 'order_update', ((row.orderNumber || id) + ': ' + Object.keys(patch).join(',')));
      return json({ ok: true, order: row }, 200, origin);
    }

    /* --------------------------- product overrides --------------------------- */

    if (path === '/product-overrides') {
      if (!may(me, 'products')) return bad('Your role cannot change products.', 403, origin);
      if (method === 'GET') return json({ overrides: await readJson(env, K.products, {}) }, 200, origin);
      if (method === 'PUT' || method === 'POST') {
        let body;
        try { body = await request.json(); } catch (e) { return bad('Invalid JSON body', 400, origin); }
        const map = body && body.overrides ? body.overrides : body;
        if (!map || typeof map !== 'object' || Array.isArray(map)) {
          return bad('Expected an object keyed by product id.', 400, origin);
        }
        const clean = {};
        Object.keys(map).forEach((k) => {
          const v = map[k];
          if (!v || typeof v !== 'object') return;
          const o = {};
          ['name', 'description', 'sku', 'category', 'brand', 'tags', 'supplierId'].forEach((f) => {
            if (typeof v[f] === 'string' && v[f]) o[f] = v[f].slice(0, 3000);
          });
          ['price', 'stock', 'discountPrice'].forEach((f) => {
            if (v[f] !== undefined && v[f] !== null && v[f] !== '') {
              const n = Number(v[f]);
              if (isFinite(n) && n >= 0) o[f] = Math.round(n);
            }
          });
          if (typeof v.status === 'string' && ['active', 'inactive'].indexOf(v.status) !== -1) o.status = v.status;
          ['featured', 'active'].forEach((f) => { if (typeof v[f] === 'boolean') o[f] = v[f]; });
          if (Array.isArray(v.images)) o.images = v.images.filter((x) => typeof x === 'string' && x).slice(0, 8);
          if (Array.isArray(v.variants)) {
            o.variants = v.variants.filter((x) => x && typeof x === 'object').map((x) => ({
              size: String(x.size || '').slice(0, 40),
              color: String(x.color || '').slice(0, 40),
              stock: Number(x.stock) || 0,
            })).slice(0, 80);
          }
          if (Object.keys(o).length) clean[String(k).slice(0, 80)] = o;
        });
        await writeJson(env, K.products, clean);
        await logActivity(env, me, 'products_save', Object.keys(clean).length + ' product overrides stored');
        return json({ ok: true, count: Object.keys(clean).length, overrides: clean }, 200, origin);
      }
      return bad('Method not allowed.', 405, origin);
    }

    /* --------------------------- customers --------------------------- */

    if (path === '/customers' && method === 'GET') {
      if (!may(me, 'customers')) return bad('Not authorised.', 403, origin);
      const [log, flags] = await Promise.all([readJson(env, K.orders, []), readJson(env, K.customers, {})]);
      return json({ customers: customersFrom(Array.isArray(log) ? log : [], flags) }, 200, origin);
    }

    if (/^\/customers\/[^/]+$/.test(path) && method === 'PATCH') {
      if (!may(me, 'customers')) return bad('Not authorised.', 403, origin);
      const key = decodeURIComponent(path.slice('/customers/'.length));
      let patch;
      try { patch = await request.json(); } catch (e) { return bad('Invalid JSON body', 400, origin); }
      const flags = await readJson(env, K.customers, {});
      const map = flags && typeof flags === 'object' ? flags : {};
      const row = map[key] || {};
      if (typeof patch.blocked === 'boolean') row.blocked = patch.blocked;
      if (typeof patch.note === 'string') row.note = patch.note.slice(0, 400);
      map[key] = row;
      await writeJson(env, K.customers, map);
      await logActivity(env, me, 'customer_update', key + ': ' + JSON.stringify(patch).slice(0, 120));
      return json({ ok: true, customer: row }, 200, origin);
    }

    /* --------------------------- inventory --------------------------- */

    if (path === '/inventory') {
      if (!may(me, 'inventory')) return bad('Not authorised.', 403, origin);
      if (method === 'GET') return json({ movements: await readJson(env, K.inventory, []) }, 200, origin);
      if (method === 'POST') {
        let body;
        try { body = await request.json(); } catch (e) { return bad('Invalid JSON body', 400, origin); }
        const qty = Number(body && body.qty);
        if (!isFinite(qty) || qty === 0) return bad('Quantity must be a non-zero number.', 400, origin);
        const log = await readJson(env, K.inventory, []);
        const list = Array.isArray(log) ? log : [];
        const row = {
          id: 'mv-' + randomHex(4),
          at: nowIso(),
          by: me.username,
          productId: String((body && body.productId) || '').slice(0, 80),
          productName: String((body && body.productName) || '').slice(0, 160),
          type: qty > 0 ? 'in' : 'out',
          qty: Math.abs(qty),
          note: String((body && body.note) || '').slice(0, 200),
        };
        list.unshift(row);
        await writeJson(env, K.inventory, list.slice(0, 600));
        await logActivity(env, me, 'inventory_move', row.type + ' ' + row.qty + ' of ' + row.productName);
        return json({ ok: true, movement: row }, 200, origin);
      }
      return bad('Method not allowed.', 405, origin);
    }

    /* --------------------------- suppliers --------------------------- */

    if (path === '/suppliers') {
      if (!may(me, 'inventory')) return bad('Not authorised.', 403, origin);
      const list = await readJson(env, K.suppliers, []);
      const rows = Array.isArray(list) ? list : [];
      if (method === 'GET') return json({ suppliers: rows }, 200, origin);
      if (method === 'POST') {
        let body;
        try { body = await request.json(); } catch (e) { return bad('Invalid JSON body', 400, origin); }
        const row = {
          id: 'sup-' + randomHex(3),
          name: String((body && body.name) || '').slice(0, 120),
          phone: String((body && body.phone) || '').slice(0, 40),
          email: String((body && body.email) || '').slice(0, 120),
          products: String((body && body.products) || '').slice(0, 300),
          note: String((body && body.note) || '').slice(0, 300),
          at: nowIso(),
        };
        if (!row.name) return bad('A supplier needs a name.', 400, origin);
        rows.unshift(row);
        await writeJson(env, K.suppliers, rows.slice(0, 200));
        await logActivity(env, me, 'supplier_add', row.name);
        return json({ ok: true, supplier: row }, 200, origin);
      }
      return bad('Method not allowed.', 405, origin);
    }

    if (/^\/suppliers\/[^/]+$/.test(path) && method === 'DELETE') {
      if (!may(me, 'inventory')) return bad('Not authorised.', 403, origin);
      const id = decodeURIComponent(path.slice('/suppliers/'.length));
      const list = await readJson(env, K.suppliers, []);
      const rows = (Array.isArray(list) ? list : []).filter((s) => s.id !== id);
      await writeJson(env, K.suppliers, rows);
      await logActivity(env, me, 'supplier_delete', id);
      return json({ ok: true }, 200, origin);
    }

    /* --------------------------- coupons / marketing --------------------------- */

    if (path === '/coupons') {
      if (!may(me, 'marketing')) return bad('Not authorised.', 403, origin);
      const list = await readJson(env, K.coupons, []);
      const rows = Array.isArray(list) ? list : [];
      if (method === 'GET') return json({ coupons: rows }, 200, origin);
      if (method === 'POST') {
        let body;
        try { body = await request.json(); } catch (e) { return bad('Invalid JSON body', 400, origin); }
        const code = String((body && body.code) || '').trim().toUpperCase();
        if (!code) return bad('A coupon needs a code.', 400, origin);
        if (rows.some((c) => c.code === code)) return bad('That code already exists.', 409, origin);
        const type = (body && body.type) === 'fixed' ? 'fixed' : 'percent';
        const value = Number(body && body.value);
        if (!isFinite(value) || value <= 0) return bad('The discount value must be greater than zero.', 400, origin);
        const row = {
          id: 'cp-' + randomHex(3),
          code, type,
          value: Math.round(value),
          minSpend: Math.max(0, Number((body && body.minSpend) || 0)),
          expiresAt: String((body && body.expiresAt) || '').slice(0, 10),
          usageLimit: Math.max(0, Number((body && body.usageLimit) || 0)),
          used: 0, active: true, createdAt: nowIso(),
        };
        rows.unshift(row);
        await writeJson(env, K.coupons, rows.slice(0, 200));
        await logActivity(env, me, 'coupon_add', code);
        return json({ ok: true, coupon: row }, 200, origin);
      }
      return bad('Method not allowed.', 405, origin);
    }

    if (/^\/coupons\/[^/]+$/.test(path) && (method === 'PATCH' || method === 'DELETE')) {
      if (!may(me, 'marketing')) return bad('Not authorised.', 403, origin);
      const id = decodeURIComponent(path.slice('/coupons/'.length));
      const list = await readJson(env, K.coupons, []);
      const rows = Array.isArray(list) ? list : [];
      const i = rows.findIndex((c) => c.id === id);
      if (i === -1) return bad('No such coupon.', 404, origin);
      if (method === 'DELETE') {
        rows.splice(i, 1);
        await writeJson(env, K.coupons, rows);
        await logActivity(env, me, 'coupon_delete', id);
        return json({ ok: true }, 200, origin);
      }
      let patch;
      try { patch = await request.json(); } catch (e) { return bad('Invalid JSON body', 400, origin); }
      if (typeof patch.active === 'boolean') rows[i].active = patch.active;
      if (patch.value !== undefined) {
        const n = Number(patch.value);
        if (isFinite(n) && n > 0) rows[i].value = Math.round(n);
      }
      await writeJson(env, K.coupons, rows);
      await logActivity(env, me, 'coupon_update', rows[i].code);
      return json({ ok: true, coupon: rows[i] }, 200, origin);
    }

    /* --------------------------- content pages + reviews --------------------------- */

    if (path === '/pages') {
      if (!may(me, 'content')) return bad('Not authorised.', 403, origin);
      if (method === 'GET') return json({ pages: await readJson(env, K.pages, {}) }, 200, origin);
      if (method === 'PUT' || method === 'POST') {
        let body;
        try { body = await request.json(); } catch (e) { return bad('Invalid JSON body', 400, origin); }
        const pages = body && body.pages ? body.pages : body;
        if (!pages || typeof pages !== 'object' || Array.isArray(pages)) return bad('Expected an object of pages.', 400, origin);
        const clean = {};
        ['about', 'privacy', 'terms', 'faq', 'return', 'contact'].forEach((k) => {
          if (typeof pages[k] === 'string') clean[k] = pages[k].slice(0, 20000);
        });
        await writeJson(env, K.pages, clean);
        await logActivity(env, me, 'pages_save', Object.keys(clean).join(','));
        return json({ ok: true, pages: clean }, 200, origin);
      }
      return bad('Method not allowed.', 405, origin);
    }

    if (path === '/reviews') {
      if (!may(me, 'content')) return bad('Not authorised.', 403, origin);
      const list = await readJson(env, K.reviews, []);
      const rows = Array.isArray(list) ? list : [];
      if (method === 'GET') return json({ reviews: rows }, 200, origin);
      if (method === 'POST') {
        let body;
        try { body = await request.json(); } catch (e) { return bad('Invalid JSON body', 400, origin); }
        const row = {
          id: 'rv-' + randomHex(3),
          productId: String((body && body.productId) || '').slice(0, 80),
          productName: String((body && body.productName) || '').slice(0, 160),
          customer: String((body && body.customer) || '').slice(0, 80),
          rating: Math.min(5, Math.max(1, Number((body && body.rating) || 5))),
          text: String((body && body.text) || '').slice(0, 1200),
          status: 'pending', reply: '', createdAt: nowIso(),
        };
        rows.unshift(row);
        await writeJson(env, K.reviews, rows.slice(0, 400));
        await logActivity(env, me, 'review_add', row.productName || row.productId);
        return json({ ok: true, review: row }, 200, origin);
      }
      return bad('Method not allowed.', 405, origin);
    }

    if (/^\/reviews\/[^/]+$/.test(path) && (method === 'PATCH' || method === 'DELETE')) {
      if (!may(me, 'content')) return bad('Not authorised.', 403, origin);
      const id = decodeURIComponent(path.slice('/reviews/'.length));
      const list = await readJson(env, K.reviews, []);
      const rows = Array.isArray(list) ? list : [];
      const i = rows.findIndex((r) => r.id === id);
      if (i === -1) return bad('No such review.', 404, origin);
      if (method === 'DELETE') {
        rows.splice(i, 1);
        await writeJson(env, K.reviews, rows);
        await logActivity(env, me, 'review_delete', id);
        return json({ ok: true }, 200, origin);
      }
      let patch;
      try { patch = await request.json(); } catch (e) { return bad('Invalid JSON body', 400, origin); }
      if (typeof patch.status === 'string' && ['pending', 'approved', 'rejected'].indexOf(patch.status) !== -1) {
        rows[i].status = patch.status;
      }
      if (typeof patch.reply === 'string') rows[i].reply = patch.reply.slice(0, 1200);
      await writeJson(env, K.reviews, rows);
      await logActivity(env, me, 'review_update', id + ' ' + rows[i].status);
      return json({ ok: true, review: rows[i] }, 200, origin);
    }

    /* --------------------------- settings --------------------------- */

    if (path === '/settings') {
      if (!may(me, 'settings')) return bad('Only a super admin can change the store settings.', 403, origin);
      if (method === 'GET') return json({ settings: normSettings(await readJson(env, K.settings, null)) }, 200, origin);
      if (method === 'PUT' || method === 'POST') {
        let body;
        try { body = await request.json(); } catch (e) { return bad('Invalid JSON body', 400, origin); }
        const next = normSettings(body && body.settings ? body.settings : body);
        next.updatedAt = nowIso();
        await writeJson(env, K.settings, next);
        await logActivity(env, me, 'settings_save', 'store settings updated');
        return json({ ok: true, settings: next }, 200, origin);
      }
      return bad('Method not allowed.', 405, origin);
    }

    /* --------------------------- accounts / roles --------------------------- */

    if (path === '/users') {
      if (!may(me, 'users')) return bad('Only a super admin can manage accounts.', 403, origin);
      const list = (await ensureBootstrap(env)) || [];
      if (method === 'GET') return json({ users: list.map(publicUser) }, 200, origin);
      if (method === 'POST') {
        let body;
        try { body = await request.json(); } catch (e) { return bad('Invalid JSON body', 400, origin); }
        const username = String((body && body.username) || '').trim().toLowerCase();
        const password = String((body && body.password) || '');
        const role = String((body && body.role) || 'staff');
        if (!/^[a-z0-9._-]{3,32}$/.test(username)) return bad('Username: 3-32 characters — letters, digits, dot, dash or underscore.', 400, origin);
        if (password.length < 8) return bad('Password must be at least 8 characters.', 400, origin);
        if (ROLES.indexOf(role) === -1) return bad('Unknown role.', 400, origin);
        if (list.some((u) => String(u.username).toLowerCase() === username)) return bad('That username is taken.', 409, origin);
        const h = await hashPassword(password);
        const row = {
          id: 'u-' + randomHex(4), username,
          name: String((body && body.name) || username).slice(0, 60),
          role, active: true, salt: h.salt, iterations: h.iterations, hash: h.hash,
          createdAt: nowIso(), lastLogin: null, mustChange: true,
        };
        list.push(row);
        await writeJson(env, K.users, list);
        await logActivity(env, me, 'user_add', username + ' (' + role + ')');
        return json({ ok: true, user: publicUser(row) }, 200, origin);
      }
      return bad('Method not allowed.', 405, origin);
    }

    if (/^\/users\/[^/]+$/.test(path) && (method === 'PATCH' || method === 'DELETE')) {
      if (!may(me, 'users')) return bad('Only a super admin can manage accounts.', 403, origin);
      const id = decodeURIComponent(path.slice('/users/'.length));
      const users = (await ensureBootstrap(env)) || [];
      const i = users.findIndex((u) => u.id === id);
      if (i === -1) return bad('No such account.', 404, origin);
      if (method === 'DELETE') {
        if (users[i].username === me.username) return bad('You cannot delete the account you are signed in with.', 400, origin);
        if (users[i].role === 'super' && users.filter((u) => u.role === 'super' && u.active !== false).length <= 1) {
          return bad('The store needs at least one active super admin.', 400, origin);
        }
        const gone = users.splice(i, 1)[0];
        await writeJson(env, K.users, users);
        await logActivity(env, me, 'user_delete', gone.username);
        return json({ ok: true }, 200, origin);
      }
      let patch;
      try { patch = await request.json(); } catch (e) { return bad('Invalid JSON body', 400, origin); }
      if (typeof patch.active === 'boolean') {
        if (!patch.active && users[i].username === me.username) return bad('You cannot block your own account.', 400, origin);
        users[i].active = patch.active;
      }
      if (typeof patch.name === 'string' && patch.name.trim()) users[i].name = patch.name.trim().slice(0, 60);
      if (typeof patch.role === 'string') {
        if (ROLES.indexOf(patch.role) === -1) return bad('Unknown role.', 400, origin);
        if (users[i].username === me.username && patch.role !== users[i].role) return bad('You cannot change your own role.', 400, origin);
        users[i].role = patch.role;
      }
      if (typeof patch.password === 'string' && patch.password) {
        if (patch.password.length < 8) return bad('Password must be at least 8 characters.', 400, origin);
        const h = await hashPassword(patch.password);
        users[i].salt = h.salt; users[i].iterations = h.iterations; users[i].hash = h.hash;
        users[i].mustChange = true;
      }
      await writeJson(env, K.users, users);
      await logActivity(env, me, 'user_update', users[i].username + ': ' + Object.keys(patch).join(','));
      return json({ ok: true, user: publicUser(users[i]) }, 200, origin);
    }

    /* --------------------------- activity + reports --------------------------- */

    if (path === '/activity' && method === 'GET') {
      if (!may(me, 'reports')) return bad('Not authorised.', 403, origin);
      const log = await readJson(env, K.activity, []);
      return json({ activity: Array.isArray(log) ? log : [] }, 200, origin);
    }

    if (path === '/reports' && method === 'GET') {
      if (!may(me, 'reports')) return bad('Not authorised.', 403, origin);
      const log = await readJson(env, K.orders, []);
      return json({
        report: buildReport(
          Array.isArray(log) ? log : [],
          url.searchParams.get('from') || '',
          url.searchParams.get('to') || ''
        ),
      }, 200, origin);
    }

    return bad('Not found.', 404, origin, { detail: 'See worker/admin.js for the route table.' });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    try {
      return await handle(request, env);
    } catch (err) {
      /* A real failure is reported as one, with the message that explains it —
         never as an empty 200 and never as Cloudflare's opaque 1101 page. */
      const msg = String((err && err.message) || err);
      console.error('[tc-admin] ' + msg + '\n' + String((err && err.stack) || ''));
      return new Response(JSON.stringify({
        error: 'The admin service hit an internal error',
        detail: msg,
        statusCode: 500,
      }), {
        status: 500,
        headers: Object.assign(
          { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
          cors(origin)
        ),
      });
    }
  },
};
