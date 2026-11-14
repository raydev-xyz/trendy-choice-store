/* Trendy Choice — hide anything that cannot be sold, everywhere
   ------------------------------------------------------------------
   Stock comes ONLY from the real BusinessKoro API (via the Worker):
     GET https://trendy.r4ydevbd.workers.dev/products
     -> data[].stockQuantity  (number)
     -> data[].inStock        (boolean)
     -> data[].variants[].stockQuantity   (per size/colour, informational)

   A product is HIDDEN from the storefront when either is true:

     1. the backend says it is out of stock
          stockQuantity <= 0  OR  inStock === false
     2. the backend does not list it at all
          -> there is no stock record and no productId, so it cannot be
             ordered; showing it would advertise something unbuyable.

   When stock returns (or the product is added back in BusinessKoro) the
   next page load shows it again. Nothing is cached.

   Where it hides them:
     - home page product grid
     - products page grid
     - the "Our Product" rail (marquee)
     - search results (filters window.PRODUCTS in place)
     - the product page itself (add-to-cart disabled + notice)

   Honesty rules:
     - No invented stock numbers. Only the API's own values.
     - If the API cannot be reached we cannot know what is sellable, so we
       show a visible banner instead of silently guessing either way.
*/
(function () {
  var WORKER = 'https://trendy.r4ydevbd.workers.dev';

  function norm(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  /* Pure: returns { hidden: [localIds], outOfStock: [localIds], missing: [localIds] }
     bkProducts = array from GET /products ; localProducts = window.PRODUCTS */
  function computeHidden(bkProducts, localProducts) {
    var byName = {};
    (bkProducts || []).forEach(function (p) { byName[norm(p.name)] = p; });
    var hidden = [], outOfStock = [], missing = [];
    (localProducts || []).forEach(function (lp) {
      var id = String(lp.id);
      var b = byName[norm(lp.t)];
      if (!b) {                       /* not in the backend: cannot be ordered */
        missing.push(id); hidden.push(id); return;
      }
      var q = Number(b.stockQuantity);
      if (!isFinite(q)) q = 0;
      if (q <= 0 || b.inStock === false) { outOfStock.push(id); hidden.push(id); }
    });
    return { hidden: hidden, outOfStock: outOfStock, missing: missing };
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

  /* Remove hidden products from the DOM + from window.PRODUCTS (which is
     what the search sheet and the marquee read from). */
  function apply(hidden) {
    var set = {};
    hidden.forEach(function (id) { set[id] = true; });

    /* The static HTML carries "Out of stock" badges baked in from an old
       CSV export. The backend is the only truth, so drop any badge on a
       product the backend says IS in stock. */
    [].slice.call(document.querySelectorAll('.p-card[data-id] .oos')).forEach(function (b) {
      var card = b.closest('.p-card');
      if (card && !set[card.getAttribute('data-id')]) b.parentNode.removeChild(b);
    });

    if (!hidden.length) return 0;

    var removed = 0;
    [].slice.call(document.querySelectorAll('.p-card[data-id]')).forEach(function (c) {
      if (set[c.getAttribute('data-id')]) { c.parentNode.removeChild(c); removed++; }
    });

    /* marquee / rail cards link to product/pN.html */
    [].slice.call(document.querySelectorAll('#mqRail .mq-card')).forEach(function (c) {
      var m = /\/p(\d+)\.html/.exec(c.getAttribute('href') || '');
      if (m && set[m[1]]) { c.parentNode.removeChild(c); removed++; }
    });

    /* search + any other window.PRODUCTS consumer */
    if (window.PRODUCTS && window.PRODUCTS.length) {
      window.PRODUCTS = window.PRODUCTS.filter(function (p) {
        return !set[String(p.id)];
      });
    }

    /* product detail page: make an unsellable item unbuyable */
    var pid = pagePid();
    if (pid && set[pid]) {
      var add = document.getElementById('add'), buy = document.getElementById('buy');
      if (add) { add.disabled = true; add.textContent = 'Out of stock'; }
      if (buy) { buy.disabled = true; buy.textContent = 'Out of stock'; }
      var cta = document.querySelector('.pdp-info .cta');
      if (cta && !document.getElementById('bkOos')) {
        var p = document.createElement('p');
        p.id = 'bkOos';
        p.style.cssText = 'margin:12px 0 0;padding:10px 13px;border-radius:12px;font-size:12px;' +
          'line-height:1.55;background:rgba(255,80,110,.12);' +
          'border:1px solid rgba(255,80,110,.4);color:#ffd4dc';
        p.textContent = 'This item is out of stock and cannot be ordered right now.';
        cta.parentNode.insertBefore(p, cta.nextSibling);
      }
    }
    return removed;
  }

  function run() {
    fetch(WORKER + '/products', { headers: { 'Accept': 'application/json' }, cache: 'no-store' })
      .then(function (res) {
        return res.text().then(function (t) {
          if (!res.ok) throw new Error('HTTP ' + res.status + ' \u2014 ' + t.slice(0, 200));
          var d = JSON.parse(t);
          return (d && d.data) ? d.data : (Array.isArray(d) ? d : []);
        });
      })
      .then(function (list) {
        var r = computeHidden(list, window.PRODUCTS || []);
        window.BKSTOCK.hiddenIds = r.hidden;
        window.BKSTOCK.outOfStockIds = r.outOfStock;
        window.BKSTOCK.missingIds = r.missing;
        window.BKSTOCK.liveCount = list.length;
        var n = apply(r.hidden);
        try {
          console.info('[stock] backend products: ' + list.length +
            ', out of stock: ' + r.outOfStock.length +
            ', not in backend: ' + r.missing.length +
            ', hidden: ' + r.hidden.length +
            ', removed from page: ' + n);
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