/* Trendy Choice — live stock + availability, everywhere
   ------------------------------------------------------------------
   Stock comes ONLY from the real BusinessKoro API (via the Worker):
     GET https://trendy.r4ydevbd.workers.dev/products
     -> data[].stockQuantity  (number)
     -> data[].inStock        (boolean)
     -> data[].variants[].stockQuantity   (per size/colour, informational)

   Matching is delegated to assets/bk-catalog.js, which keys on the
   backend SLUG (then name, then token similarity). The old version of
   this file matched on the product NAME only, so a product whose local
   title differed from the backend title by one character was treated as
   "not in the backend" and silently deleted from the page. That is what
   made 22 products vanish. A product is no longer removed for a name
   mismatch.

   What happens to a product now:

     in stock            -> shown normally
     out of stock        -> shown, marked "Out of stock", add-to-cart off
     not in the backend  -> shown, marked "Unavailable", add-to-cart off
                            (it cannot be ordered, but hiding it would
                            misrepresent the catalogue)

   Honesty rules:
     - No invented stock numbers. Only the API's own values.
     - If the API cannot be reached we cannot know what is sellable, so we
       show a visible banner instead of silently guessing either way.
*/
(function () {
  var WORKER = 'https://trendy.r4ydevbd.workers.dev';

  /* Minimal slug/name matcher, used only if bk-catalog.js did not load.
     Without this a missing client would make EVERY product look "not in
     the backend" and the whole shop would be marked unavailable. */
  function slugify(s) {
    return String(s || '').toLowerCase()
      .replace(/&amp;/g, ' and ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
  function normName(s) {
    return String(s || '').toLowerCase()
      .replace(/&amp;/g, ' and ')
      .replace(/[^a-z0-9\u0980-\u09FF]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  function localMatch(lp, list) {
    if (!lp || !list) return null;
    var s = slugify(lp.t), n = normName(lp.t), i;
    for (i = 0; i < list.length; i++) if (list[i].slug === s) return list[i];
    for (i = 0; i < list.length; i++) if (normName(list[i].name) === n) return list[i];
    return null;
  }

  /* Pure: classify the bundled catalogue against the live backend.
     Returns { hidden, outOfStock, missing, unavailable } as local ids.
     `hidden` is kept for backwards compatibility and is now always empty:
     nothing is removed from the page any more. */
  function computeHidden(bkProducts, localProducts) {
    var outOfStock = [], missing = [];
    (localProducts || []).forEach(function (lp) {
      var b = window.BKCAT && window.BKCAT.matchOne
        ? window.BKCAT.matchOne(lp, bkProducts)
        : localMatch(lp, bkProducts);
      var id = String(lp.id);
      if (!b) { missing.push(id); return; }
      var q = Number(b.stockQuantity);
      if (!isFinite(q)) q = 0;
      if (q <= 0 || b.inStock === false) outOfStock.push(id);
    });
    return {
      hidden: [],
      outOfStock: outOfStock,
      missing: missing,
      unavailable: outOfStock.concat(missing)
    };
  }
  window.BKSTOCK = { computeHidden: computeHidden };

  function banner(msg, kind) {
    if (document.getElementById('bkStockNote')) return;
    var wrap = document.querySelector('.wrap') || document.body;
    var d = document.createElement('div');
    d.id = 'bkStockNote';
    var bad = kind !== 'ok';
    d.style.cssText = 'margin:14px 0 18px;padding:11px 14px;border-radius:14px;' +
      'font-size:12.5px;line-height:1.55;' +
      (bad
        ? 'background:rgba(255,80,110,.12);border:1px solid rgba(255,80,110,.4);color:#ffd4dc'
        : 'background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);color:rgba(255,255,255,.75)');
    d.textContent = msg;
    wrap.insertBefore(d, wrap.firstChild);
  }

  function pagePid() {
    var m = /\/p(\d+)\.html(?:$|[?#])/.exec(location.pathname);
    return m ? m[1] : null;
  }

  function markCard(card, label) {
    if (!card || card.querySelector('.oos')) return;
    var thumb = card.querySelector('.thumb') || card.querySelector('.ph') || card;
    var s = document.createElement('span');
    s.className = 'oos';
    s.textContent = label;
    thumb.insertBefore(s, thumb.firstChild);
    var add = card.querySelector('[data-add]');
    if (add) { add.disabled = true; add.setAttribute('aria-disabled', 'true'); }
  }

  /* Apply availability to the DOM. Nothing is removed. */
  function apply(state) {
    var oos = {}, miss = {};
    (state.outOfStock || []).forEach(function (id) { oos[id] = 1; });
    (state.missing || []).forEach(function (id) { miss[id] = 1; });

    /* The static HTML carries "Out of stock" badges baked in from an old
       CSV export. The backend is the only truth, so drop any badge on a
       product the backend says IS in stock. */
    [].slice.call(document.querySelectorAll('.p-card[data-id] .oos, .mq-card .oos')).forEach(function (b) {
      var card = b.closest('.p-card') || b.closest('.mq-card');
      if (!card) return;
      var id = card.getAttribute('data-id');
      if (!id) {
        var m = /\/p(\d+)\.html/.exec(card.getAttribute('href') || '');
        id = m ? m[1] : null;
      }
      if (id && !oos[id] && !miss[id]) b.parentNode.removeChild(b);
    });

    var marked = 0;
    /* Safety valve: if the backend answered but NOTHING matched, the shape
       of the response probably changed. Marking the entire shop
       "Unavailable" would be worse than saying so, so bail out. */
    var total = document.querySelectorAll('.p-card[data-id]').length;
    if (total > 5 && state.missing && state.missing.length >= total) {
      banner('The live store answered, but none of its products could be matched to this ' +
        'page, so availability is not shown. Please reload in a moment.', 'bad');
      return 0;
    }

    [].slice.call(document.querySelectorAll('.p-card[data-id]')).forEach(function (c) {
      var id = c.getAttribute('data-id');
      if (miss[id]) { markCard(c, 'Unavailable'); marked++; }
      else if (oos[id]) { markCard(c, 'Out of stock'); marked++; }
    });

    /* product detail page: make an unsellable item unbuyable */
    var pid = pagePid();
    if (pid && (oos[pid] || miss[pid])) {
      var add = document.getElementById('add'), buy = document.getElementById('buy');
      var label = miss[pid] ? 'Unavailable' : 'Out of stock';
      if (add) { add.disabled = true; add.textContent = label; }
      if (buy) { buy.disabled = true; buy.textContent = label; }
      var cta = document.querySelector('.pdp-info .cta');
      if (cta && !document.getElementById('bkOos')) {
        var p = document.createElement('p');
        p.id = 'bkOos';
        p.style.cssText = 'margin:12px 0 0;padding:10px 13px;border-radius:12px;font-size:12px;' +
          'line-height:1.55;background:rgba(255,80,110,.12);' +
          'border:1px solid rgba(255,80,110,.4);color:#ffd4dc';
        p.textContent = miss[pid]
          ? 'This item is not in the live store catalogue right now, so it cannot be ordered.'
          : 'This item is out of stock and cannot be ordered right now.';
        cta.parentNode.insertBefore(p, cta.nextSibling);
      }
    }
    return marked;
  }

  /* Pages that do not carry the API client in their own <script> tags
     (the 72 product pages, cart, account) get it injected here, so the
     slug-based matching in bk-catalog.js is always available. */
  function ensureClient() {
    if (window.BKCAT && window.BK) return Promise.resolve(true);
    var base = document.body.getAttribute('data-base') || '';
    function add(src) {
      return new Promise(function (resolve) {
        var s = document.createElement('script');
        s.src = base + src;
        s.onload = function () { resolve(true); };
        s.onerror = function () { resolve(false); };
        document.head.appendChild(s);
      });
    }
    return add('assets/bk-api.js').then(function (ok) {
      return ok ? add('assets/bk-catalog.js') : false;
    });
  }

  function run() {
    /* Prefer the shared client so the catalogue is fetched once, not twice. */
    var ready = ensureClient().then(function () {
      return (window.BKCAT && window.BK)
      ? window.BKCAT.load().then(function () { return window.BKCAT.catalog(); })
      : fetch(WORKER + '/products', { headers: { 'Accept': 'application/json' }, cache: 'no-store' })
        .then(function (res) {
          return res.text().then(function (t) {
            if (!res.ok) throw new Error('HTTP ' + res.status + ' \u2014 ' + t.slice(0, 200));
            var d = JSON.parse(t);
            return (d && d.data) ? d.data : (Array.isArray(d) ? d : []);
          });
        });
    });

    ready.then(function (list) {
      /* `list` must be the backend's OWN list, not the merged catalogue:
         computeHidden matches bundled products against backend records. */
      var raw = (window.BKCAT && window.BKCAT.raw) ? window.BKCAT.raw() : null;
      if (raw) list = raw;
      var bundled = (window.BKCAT && window.BKCAT.catalog) ? window.BKCAT.catalog() : (window.PRODUCTS || []);
      var r = computeHidden(list, bundled);
      window.BKSTOCK.hiddenIds = r.hidden;
      window.BKSTOCK.outOfStockIds = r.outOfStock;
      window.BKSTOCK.missingIds = r.missing;
      window.BKSTOCK.liveCount = list.length;
      var n = apply(r);
      try {
        console.info('[stock] backend products: ' + list.length +
          ', out of stock: ' + r.outOfStock.length +
          ', not in backend: ' + r.missing.length +
          ', marked on page: ' + n);
      } catch (e) {}
    }, function (err) {
      /* Cannot know stock -> say so, do not silently guess. */
      banner('Live stock could not be read (' + (err && err.message ? err.message : 'API unreachable') +
        '), so out-of-stock items may still be listed. Please reload in a moment.', 'bad');
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
