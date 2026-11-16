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
    renderNewArrivals(shown);
    try {
      console.info('[catalog] rendered ' + n + ' sellable products' +
        (window.BKCAT && window.BKCAT.liveCount ? ' (backend lists ' + window.BKCAT.liveCount + ')' : ''));
    } catch (e) {}
  }

  /* ---- New Arrival slider -------------------------------------------------
     Big, product-detail-sized photos, one at a time, auto-advancing every
     4.5s, with dot indicators and touch/mouse swipe. Image only — tapping a
     slide opens that product's detail page.

     Which products appear: the ones the owner picked in the admin panel
     (config.newArrivals), in that order. If they have not picked any, the
     newest products in the live catalogue are used, so the section is never
     empty on a fresh store. */
  function newArrivalPicks(list) {
    var cfg = (window.STORE && window.STORE.config) ? window.STORE.config() : null;
    var wanted = (cfg && cfg.newArrivals) || [];
    var byId = {};
    list.forEach(function (p) { byId[String(p.id)] = p; });
    var picked = [];
    wanted.forEach(function (k) {
      var p = byId[String(k)];
      if (p && !p.unavailable && Number(p.s) > 0) picked.push(p);
    });
    if (picked.length) return picked.slice(0, 10);
    /* no explicit picks: the tail of the catalogue is the newest stock */
    return list.filter(function (p) { return !p.unavailable && Number(p.s) > 0; }).slice(-8).reverse();
  }

  function renderNewArrivals(list) {
    var host = document.getElementById('naSlides');
    if (!host) return;
    var picks = newArrivalPicks(list);
    var dots = document.getElementById('naDots');
    var sec = document.getElementById('newArrival');
    if (!picks.length) {
      if (sec) sec.hidden = true;
      return;
    }
    if (sec) sec.hidden = false;

    host.innerHTML = picks.map(function (p, i) {
      return '<a class="na-slide' + (i === 0 ? ' on' : '') + '" href="' + esc(hrefFor(p)) +
        '" data-i="' + i + '" aria-label="' + esc(p.t) + '">' +
        '<img src="' + esc(imgSrc(p)) + '" alt="' + esc(p.t) + '"' +
        (i === 0 ? '' : ' loading="lazy"') + '>' +
        '</a>';
    }).join('');

    if (dots) {
      dots.innerHTML = picks.map(function (p, i) {
        return '<button type="button" class="na-dot' + (i === 0 ? ' on' : '') + '" data-i="' + i +
          '" aria-label="Show ' + esc(p.t) + '"' + (i === 0 ? ' aria-current="true"' : '') + '></button>';
      }).join('');
    }

    wireNewArrivals(host, dots, picks.length);
  }

  var naTimer = null;
  function wireNewArrivals(host, dots, count) {
    if (host.__wired) {
      /* a repaint (e.g. after the admin saved) restarts from the first slide */
      if (naTimer) { clearInterval(naTimer); naTimer = null; }
    }
    host.__wired = true;
    var i = 0;

    function show(n) {
      i = (n + count) % count;
      [].slice.call(host.querySelectorAll('.na-slide')).forEach(function (s, k) {
        s.classList.toggle('on', k === i);
      });
      if (dots) {
        [].slice.call(dots.querySelectorAll('.na-dot')).forEach(function (d, k) {
          d.classList.toggle('on', k === i);
          if (k === i) d.setAttribute('aria-current', 'true');
          else d.removeAttribute('aria-current');
        });
      }
    }

    function start() {
      if (naTimer) clearInterval(naTimer);
      if (count < 2) return;
      naTimer = setInterval(function () { show(i + 1); }, 4500);
    }
    function stop() { if (naTimer) { clearInterval(naTimer); naTimer = null; } }

    if (dots && !dots.__wired) {
      dots.__wired = true;
      dots.addEventListener('click', function (e) {
        var d = e.target && e.target.closest ? e.target.closest('.na-dot') : null;
        if (!d) return;
        e.preventDefault();
        show(Number(d.getAttribute('data-i')));
        start();
      });
    }

    /* swipe: touch and mouse, so it works on a phone and on a desktop */
    var x0 = null, dragging = false;
    function down(x) { x0 = x; dragging = true; stop(); }
    function up(x) {
      if (!dragging || x0 === null) return;
      var dx = x - x0;
      dragging = false; x0 = null;
      if (Math.abs(dx) > 40) show(i + (dx < 0 ? 1 : -1));
      start();
    }
    host.addEventListener('touchstart', function (e) { down(e.touches[0].clientX); }, { passive: true });
    host.addEventListener('touchend', function (e) { up(e.changedTouches[0].clientX); }, { passive: true });
    host.addEventListener('mousedown', function (e) { down(e.clientX); });
    host.addEventListener('mouseup', function (e) { up(e.clientX); });
    host.addEventListener('mouseleave', function () { dragging = false; x0 = null; start(); });

    /* a swipe must not also open the product */
    host.addEventListener('click', function (e) {
      if (host.__swiped) { e.preventDefault(); host.__swiped = false; }
    });
    host.addEventListener('touchmove', function () { host.__swiped = true; }, { passive: true });

    /* pause while the pointer is over it, so a customer can look */
    host.addEventListener('mouseenter', stop);
    host.addEventListener('mouseleave', start);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stop(); else start();
    });

    show(0);
    start();
  }

  function boot() {
    if (!window.BKCAT || !window.BK) return;   /* no client: keep the static cards */
    /* the admin panel's settings and the catalogue are two independent
       requests; wait for both so the first paint already honours the owner's
       hidden / pinned / price choices instead of flickering through them */
    var settings = (window.STORE && window.STORE.ready) ? window.STORE.ready : Promise.resolve(null);
    Promise.all([window.BKCAT.load(), settings]).then(function () {
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

/* ---- banner (admin panel: hero.slides) ----------------------------------
   The shop ships with its own two banner images. When the owner adds banner
   URLs in the admin panel they replace them, in the order given, and rotate
   on the same 4.5s beat as the New Arrival slider. Leaving the list empty
   keeps the built-in banners exactly as they were. */
(function () {
  function paintHero() {
    var cfg = (window.STORE && window.STORE.config) ? window.STORE.config() : null;
    var slides = (cfg && cfg.hero && cfg.hero.slides) || [];
    var host = document.getElementById('heroSlides');
    if (!host || !slides.length) return;

    host.innerHTML = slides.map(function (u, i) {
      return '<img class="' + (i === 0 ? 'on' : '') + '" src="' + u.replace(/"/g, '&quot;') +
        '" alt="Trendy Choice banner" loading="' + (i === 0 ? 'eager' : 'lazy') + '">';
    }).join('');

    if (slides.length < 2) return;
    var i = 0;
    setInterval(function () {
      var imgs = host.querySelectorAll('img');
      i = (i + 1) % imgs.length;
      [].slice.call(imgs).forEach(function (im, k) { im.classList.toggle('on', k === i); });
    }, 4500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      if (window.STORE && window.STORE.ready) window.STORE.ready.then(paintHero);
      else paintHero();
    });
  } else {
    if (window.STORE && window.STORE.ready) window.STORE.ready.then(paintHero);
    else paintHero();
  }
})();
