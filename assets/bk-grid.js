/* Trendy Choice — render the product grid from the LIVE catalogue
   ------------------------------------------------------------------
   Before this file existed, index.html and products.html carried 72
   product cards hardcoded in the HTML, and products.js carried the same
   72 in a JS array. The API was only ever used to HIDE things, so a
   product added in BusinessKoro never appeared on the site, and a
   product whose name did not match exactly was deleted from the page.

   Now the grid is built from window.BKCAT.catalog(), which is the real
   backend catalogue merged with the bundled one (see bk-catalog.js).
   Add a product in BusinessKoro and it shows up here on the next load.

   If the API cannot be reached the bundled cards already in the HTML
   stay exactly as they are — the page never goes blank and never
   pretends to have live data.
*/
(function () {
  var BASE = document.body.getAttribute('data-base') || '';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function money(n) {
    return '\u09F3' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
  }

  function imgSrc(p) {
    var i = p.i || '';
    if (/^https?:\/\//i.test(i)) return i;
    return BASE + i;
  }

  function hrefFor(p) {
    if (p.href) return BASE + p.href;
    return BASE + 'product/p' + p.id + '.html';
  }

  function card(p) {
    var out = p.unavailable || Number(p.s) <= 0;
    var label = p.unavailable ? 'Unavailable' : 'Out of stock';
    return '<a class="p-card" href="' + esc(hrefFor(p)) + '" data-id="' + esc(p.id) + '">' +
      '<span class="thumb">' +
        (out ? '<span class="oos">' + label + '</span>' : '') +
        '<img src="' + esc(imgSrc(p)) + '" alt="' + esc(p.t) + '" loading="lazy">' +
      '</span>' +
      '<span class="meta"><h3>' + esc(p.t) + '</h3>' +
        '<span class="row"><span class="price">' + money(p.p) + '</span>' +
        '<button class="add" data-add="' + esc(p.id) + '" aria-label="Add to cart"' +
          (out ? ' disabled' : '') + '>' +
          '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>' +
        '</button></span>' +
      '</span></a>';
  }

  function renderGrids(list) {
    var grids = [].slice.call(document.querySelectorAll('.grid'));
    if (!grids.length) return 0;
    var html = list.map(card).join('');
    grids.forEach(function (g) { g.innerHTML = html; });
    return list.length;
  }

  function renderMarquee(list) {
    var host = document.getElementById('mqRail');
    if (!host) return;
    var picks = list.filter(function (p) { return !p.unavailable && Number(p.s) > 0; }).slice(0, 18);
    if (!picks.length) return;
    var one = picks.map(function (p) {
      return '<a class="mq-card" href="' + esc(hrefFor(p)) + '" aria-label="' + esc(p.t) + '">' +
        '<span class="ph"><img src="' + esc(imgSrc(p)) + '" alt="" loading="lazy"></span></a>';
    }).join('');
    host.innerHTML = '<div class="mq-track">' + one + one + '</div>';
  }

  function paint(list) {
    /* Out-of-stock and not-in-catalogue products are not listed at all —
       see sellable() in bk-catalog.js. */
    var shown = window.BKCAT && window.BKCAT.sellable ? window.BKCAT.sellable() : list;
    var n = renderGrids(shown);
    renderMarquee(shown);
    try {
      console.info('[catalog] rendered ' + n + ' sellable products' +
        (window.BKCAT && window.BKCAT.liveCount ? ' (backend lists ' + window.BKCAT.liveCount + ')' : ''));
    } catch (e) {}
  }

  function boot() {
    if (!window.BKCAT || !window.BK) return;   /* no client: keep the static cards */
    window.BKCAT.load().then(function () {
      paint(window.BKCAT.catalog());
    }, function (err) {
      /* bk-api.js already falls back to data/stock.json, so reaching here means
         neither the Worker NOR the snapshot answered. The cards baked into the
         HTML are an old export and may list products that cannot be sold, so
         say so rather than letting them pass for the live catalogue. */
      try { console.warn('[catalog] live catalogue unavailable: ' + (err && err.message)); } catch (e) {}
      var wrap = document.querySelector('.wrap') || document.body;
      if (wrap && !document.getElementById('bkGridNote')) {
        var d = document.createElement('div');
        d.id = 'bkGridNote';
        d.style.cssText = 'margin:14px 0 18px;padding:11px 14px;border-radius:14px;font-size:12.5px;' +
          'line-height:1.55;background:rgba(255,80,110,.12);border:1px solid rgba(255,80,110,.4);color:#ffd4dc';
        d.textContent = 'The live store could not be reached, so availability below may be out of date. ' +
          'Please reload in a moment.';
        wrap.insertBefore(d, wrap.firstChild);
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
