/* Trendy Choice — BusinessKoro storefront API client
   ------------------------------------------------------------------
   The browser never sees the API key. Every call goes to the deployed
   Cloudflare Worker, which adds the x-api-key header server-side and
   forwards to https://api.businesskoro.com/api/v1/storefront.

   Design rules (deliberate):
     - No mock data. No fabricated success.
     - Every failure surfaces the REAL HTTP status and the REAL response
       body. Nothing is swallowed, nothing is replaced by a friendly
       fallback that hides the problem.
     - The catalogue is only ever the real backend catalogue. If the
       backend is unreachable the storefront says so; it does not quietly
       serve a hardcoded list as if it were live.
*/
(function () {
  var WORKER = 'https://trendy.r4ydevbd.workers.dev';

  function ApiError(message, status, body) {
    var e = new Error(message);
    e.name = 'BkApiError';
    e.status = status;
    e.body = body;
    return e;
  }

  /* Turn any response into a readable, honest error. */
  function fail(res, text) {
    var parsed = null;
    try { parsed = JSON.parse(text); } catch (e) { /* keep raw text */ }
    var detail = '';
    if (parsed) {
      if (Array.isArray(parsed.message)) detail = parsed.message.join('; ');
      else if (parsed.message) detail = String(parsed.message);
      else if (parsed.error) detail = String(parsed.error);
    } else if (text) {
      detail = text.slice(0, 300);
    }
    var msg = 'HTTP ' + res.status + (detail ? ' — ' + detail : '');
    throw ApiError(msg, res.status, parsed || text);
  }

  function request(path, options) {
    options = options || {};
    return fetch(WORKER + path, {
      method: options.method || 'GET',
      headers: options.body
        ? { 'Content-Type': 'application/json', 'Accept': 'application/json' }
        : { 'Accept': 'application/json' },
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache: 'no-store'
    }).then(function (res) {
      return res.text().then(function (text) {
        if (!res.ok) fail(res, text);
        try { return JSON.parse(text); }
        catch (e) { throw ApiError('HTTP ' + res.status + ' — response was not JSON', res.status, text); }
      });
    }, function (netErr) {
      /* Network-level failure: report it as such, do not pretend it worked. */
      throw ApiError('Network error reaching the order service — ' +
        (netErr && netErr.message ? netErr.message : 'request failed'), 0, null);
    });
  }

  window.BK = {
    worker: WORKER,

    /* GET /products -> real catalogue.
       If the Worker cannot be reached, data/stock.json is used instead — the
       snapshot scripts/sync-stock.mjs refreshes every 30 minutes. It is
       declared as a fallback so nobody mistakes it for a live answer: the
       returned object carries `stale: true` and the snapshot's own timestamp. */
    products: function () {
      return request('/products').then(function (d) {
        var list = (d && d.data) ? d.data : (Array.isArray(d) ? d : []);
        return { products: list, deliveryCharges: (d && d.deliveryCharges) || null, raw: d, stale: false };
      }, function (err) {
        return snapshot().then(function (snap) {
          if (!snap) throw err;                       /* no snapshot: keep the real error */
          window.BK.fallback = { at: snap.generatedAt, reason: String(err && err.message || err) };
          return {
            products: snap.products.map(function (p) {
              return {
                id: p.id, slug: p.slug, name: p.name,
                suggestedPrice: p.price, stockQuantity: p.stock, inStock: p.inStock,
                variants: (p.variants || []).map(function (v) {
                  return { color: v.color, size: v.size, stockQuantity: v.stock, inStock: v.inStock };
                })
              };
            }),
            deliveryCharges: null,
            raw: snap,
            stale: true,
            generatedAt: snap.generatedAt
          };
        });
      });
    },

    /* POST /orders -> real order. One call = one unit of one product. */
    placeOrder: function (payload) {
      return request('/orders', { method: 'POST', body: payload });
    },

    /* GET /orders/:id -> real order status */
    order: function (id) {
      return request('/orders/' + encodeURIComponent(id));
    }
  };

  /* The committed stock snapshot, read at most once per page. */
  var SNAP = null;
  function snapshot() {
    if (SNAP) return Promise.resolve(SNAP);
    var base = (document.body && document.body.getAttribute('data-base')) || '';
    return fetch(base + 'data/stock.json', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !Array.isArray(d.products) || !d.products.length) return null;
        SNAP = d;
        return d;
      })
      .catch(function () { return null; });
  }
})();
