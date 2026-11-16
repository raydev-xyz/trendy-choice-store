/* Trendy Choice — product detail page controller
   ------------------------------------------------------------------
   One script for BOTH kinds of product page:

     product/p7.html          a bundled page (name, price and stock were baked
                              into the HTML when the site was exported)
     product/view.html?p=<id> any other product, including ones that exist only
                              in BusinessKoro

   Why this file exists (the three bugs it fixes):

   1+3. The pages used to paint their baked-in content immediately and then let
        the live catalogue correct it. So opening K8 Earbuds could briefly show
        the previous product's name, its photo and its stock number, and
        view.html always flashed the p01.jpg image it shipped with. Now the
        record is looked up and the DOM is EMPTIED *before* anything is shown:
        name, price, image, stock and variants are all reset to a loading state
        on the first line of boot(), and only the product we resolved is
        painted. A stale image can no longer appear because there is no image
        until the right one is known.

   2.   Variant chips silently stopped working. stock-filter.js repaints the
        chip list from the backend's own variants, which replaces the DOM nodes;
        the page script had captured the OLD nodes and kept listening to those,
        so clicks after the repaint only set the highlight and never reached the
        cart. The chips are now handled by delegation on the container, so a
        repaint cannot orphan them, and the chosen value is written to
        window.VARIANTS so the cart and checkout send it with the order.

   Nothing is invented: every value comes from window.BKCAT (the live catalogue)
   or, if the API cannot be reached, from the bundled data with a visible note
   saying so.
*/
(function () {
  var BASE = document.body.getAttribute('data-base') || '';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>\"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function money(n) {
    if (window.money) return window.money(n);
    return '\u09F3' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
  }

  function imgUrl(p) {
    var i = (p && (p.big || p.i)) || '';
    if (!i) return '';
    if (/^https?:\/\//i.test(i)) return i;
    return BASE + i;
  }

  function pageKey() {
    var m = /\/p(\d+)\.html(?:$|[?#])/.exec(location.pathname);
    if (m) return m[1];
    var q = new RegExp('[?&]p=([^&]*)').exec(location.search);
    if (q) return decodeURIComponent(q[1]);
    /* a backend-only product reached through the short /product/<slug> form */
    var s = new RegExp('[?&]slug=([^&]*)').exec(location.search);
    if (s) return 'slug:' + decodeURIComponent(s[1]);
    return null;
  }

  var el = {};
  function grab() {
    el.name = document.querySelector('.pdp-info h1');
    el.meta = document.querySelector('.pdp-meta');
    el.price = document.querySelector('.price-row .now');
    el.hint = document.querySelector('.price-row .hint');
    el.img = document.querySelector('.pdp-media img');
    el.flag = document.querySelector('.stock-flag');
    el.opts = document.querySelector('.opts');
    el.desc = document.querySelector('.desc-block p');
    el.crumb = document.querySelector('.back-bar .crumb');
    el.add = document.getElementById('add');
    el.buy = document.getElementById('buy');
    el.cta = document.querySelector('.pdp-info .cta');
    el.chat = document.querySelector('.chat-card');
  }

  /* ---- the reset that makes bugs 1 and 3 impossible ----
     Everything that identified the previous product is cleared here, before
     any lookup or fetch, so there is nothing stale left to show. */
  function clearProduct() {
    if (el.name) el.name.textContent = 'Loading product\u2026';
    if (el.meta) el.meta.innerHTML = '';
    if (el.price) el.price.textContent = '';
    if (el.hint) el.hint.textContent = '';
    if (el.flag) el.flag.innerHTML = '';
    if (el.crumb) el.crumb.textContent = 'Shop';
    if (el.opts) el.opts.innerHTML = '';
    if (el.desc) el.desc.textContent = '';
    if (el.img) {
      /* drop the source entirely: an <img> with no src paints nothing, so the
         previous product's photo cannot flash up */
      el.img.removeAttribute('src');
      el.img.removeAttribute('srcset');
      el.img.alt = '';
      el.img.classList.add('is-loading');
    }
    if (el.add) { el.add.disabled = true; el.add.textContent = 'Add to cart'; }
    if (el.buy) { el.buy.disabled = true; el.buy.textContent = 'Buy now'; }
    var old = document.getElementById('pdpNote');
    if (old) old.parentNode.removeChild(old);
    var flagless = document.getElementById('pdpOos');
    if (flagless) flagless.parentNode.removeChild(flagless);
    document.title = 'Loading product\u2026 \u00b7 Trendy Choice';
  }

  function note(text, bad) {
    if (!el.cta) return;
    var p = document.createElement('p');
    p.id = 'pdpNote';
    p.style.cssText = 'margin:12px 0 0;padding:10px 13px;border-radius:12px;font-size:12px;line-height:1.55;' +
      (bad
        ? 'background:rgba(255,80,110,.12);border:1px solid rgba(255,80,110,.4);color:#ffd4dc'
        : 'background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);color:rgba(255,255,255,.75)');
    p.textContent = text;
    el.cta.parentNode.insertBefore(p, el.cta.nextSibling);
  }

  /* ---- variants ------------------------------------------------------------
     Read the current pick straight from the DOM instead of from a cached node
     list, so a repaint by stock-filter.js cannot desync it. */
  function readPicked(key) {
    var picked = {};
    if (window.VARIANTS && window.VARIANTS.get) {
      picked = Object.assign({}, window.VARIANTS.get(key) || {});
    }
    if (el.opts) {
      [].slice.call(el.opts.querySelectorAll('.opt-chip[aria-pressed="true"]')).forEach(function (c) {
        picked[c.getAttribute('data-g')] = c.getAttribute('data-v');
      });
    }
    return picked;
  }

  function groupsOf(p) {
    var groups = {}, order = [];
    var src = (p && p.opts && p.opts.length)
      ? p.opts
      : (function () {
        /* fall back to the backend's variant rows when the merged record has
           no option groups of its own */
        var b = (window.BKCAT && window.BKCAT.backend) ? window.BKCAT.backend(p ? p.id : null) : null;
        var g = {}, o = [];
        ((b && b.variants) || []).forEach(function (v) {
          if (v.color) { if (!g.Color) { g.Color = []; o.push('Color'); } if (g.Color.indexOf(v.color) === -1) g.Color.push(v.color); }
          if (v.size) { if (!g.Size) { g.Size = []; o.push('Size'); } if (g.Size.indexOf(v.size) === -1) g.Size.push(v.size); }
        });
        return o.map(function (k) { return { n: k, v: g[k] }; });
      })();
    src.forEach(function (g) {
      if (!g || !g.n || !g.v || !g.v.length) return;
      groups[g.n] = g.v; order.push(g.n);
    });
    return { names: order, values: groups };
  }

  function paintOptions(p, key) {
    if (!el.opts) return;
    var g = groupsOf(p);
    var saved = (window.VARIANTS && window.VARIANTS.get) ? (window.VARIANTS.get(key) || {}) : {};
    if (!g.names.length) {
      el.opts.innerHTML = '';
      return;
    }
    el.opts.innerHTML = g.names.map(function (n) {
      var vals = g.values[n];
      var keep = saved[n] && vals.indexOf(saved[n]) !== -1 ? saved[n] : vals[0];
      return '<div class="opt-group"><h3>' + esc(n) + '</h3><div class="opt-vals">' +
        vals.map(function (v) {
          return '<button class="opt-chip" type="button" data-g="' + esc(n) + '" data-v="' + esc(v) +
            '" aria-pressed="' + (v === keep ? 'true' : 'false') + '">' + esc(v) + '</button>';
        }).join('') +
        '</div></div>';
    }).join('');
    /* remember the default so a customer who never touches the chips still
       sends a valid variant */
    if (window.VARIANTS) {
      g.names.forEach(function (n) {
        var chosen = el.opts.querySelector('.opt-chip[data-g="' + n + '"][aria-pressed="true"]');
        if (chosen) window.VARIANTS.set(key, n, chosen.getAttribute('data-v'));
      });
    }
  }

  /* delegation: one listener, survives any repaint of the chip list */
  function wireChips(key) {
    if (!el.opts || el.opts.__wired) return;
    el.opts.__wired = true;
    el.opts.addEventListener('click', function (e) {
      var c = e.target && e.target.closest ? e.target.closest('.opt-chip') : null;
      if (!c) return;
      var group = c.getAttribute('data-g');
      [].slice.call(el.opts.querySelectorAll('.opt-chip')).forEach(function (o) {
        if (o.getAttribute('data-g') === group) o.setAttribute('aria-pressed', o === c ? 'true' : 'false');
      });
      if (window.VARIANTS) window.VARIANTS.set(key, group, c.getAttribute('data-v'));
      syncChat(key);
    });
  }

  /* the WhatsApp bubble repeats the product name and price, so it has to be
     rebuilt for the product actually on screen */
  function syncChat(key, p) {
    if (!el.chat) return;
    var name = el.name ? el.name.textContent.trim() : '';
    var price = el.price ? el.price.textContent.trim() : '';
    if (!name || !price) return;
    var picked = readPicked(key);
    var v = Object.keys(picked).map(function (k) { return k + ': ' + picked[k]; }).join(', ');
    var body = el.chat.querySelector('.bubble');
    if (body) {
      body.innerHTML = 'Assalamu alaikum! Want <b>' + esc(name) + '</b> for <b>' + esc(price) +
        '</b>? Send a message with your name, address and quantity \u2014 we confirm delivery and ' +
        'payment right away.<time>Now</time>';
    }
    var wa = el.chat.querySelector('#wa');
    if (wa) {
      var txt = 'Hi! I want to order ' + name + ' for ' + price + (v ? ' (' + v + ')' : '') + '.';
      var m = (wa.getAttribute('href') || '').split('?')[0];
      wa.href = m + '?text=' + encodeURIComponent(txt);
    }
  }

  /* ---- paint a resolved product ---- */
  function paint(p, key, stale) {
    var live = !p.unavailable && Number(p.s) > 0;
    var price = (p.p === undefined || p.p === null) ? null : Number(p.p);

    if (el.name) el.name.textContent = p.t || 'Product';
    if (el.crumb) el.crumb.textContent = p.c || 'Shop';
    if (el.price) el.price.textContent = price === null ? '\u2014' : money(price);
    if (el.desc) el.desc.textContent = String(p.d || '').replace(/^#+\s*/gm, '').replace(/\*\*/g, '').trim() || 'No description provided.';

    if (el.meta) {
      var bits = ['<span>' + esc(p.c || 'Shop') + '</span>', '<span class="dot"></span>'];
      bits.push(live
        ? '<span>' + Number(p.s).toLocaleString('en-US') + ' in stock</span>'
        : '<span>' + (p.unavailable ? 'Not in the live store' : 'Out of stock') + '</span>');
      el.meta.innerHTML = bits.join('');
    }

    if (el.flag) {
      el.flag.innerHTML = live
        ? '<span class="badge ok">In stock</span>'
        : '<span class="badge no">' + (p.unavailable ? 'Unavailable' : 'Out of stock') + '</span>';
    }

    if (el.img) {
      var src = imgUrl(p);
      el.img.classList.remove('is-loading');
      if (src) {
        el.img.src = src;
        el.img.alt = p.t || '';
        el.img.style.visibility = '';
        /* keep the box empty until the real photo has decoded, so a slow image
           never shows a spinner over the previous product's picture */
        el.img.style.opacity = '0';
        var reveal = function () { el.img.style.opacity = '1'; };
        if (el.img.complete && el.img.naturalWidth) reveal();
        else {
          el.img.addEventListener('load', reveal, { once: true });
          el.img.addEventListener('error', function () {
            el.img.style.opacity = '0';
            el.img.style.visibility = 'hidden';
            note('The photo for this product could not be loaded. Everything else on this page is live data.', false);
          }, { once: true });
        }
      }
    }

    document.title = (p.t || 'Product') + ' \u00b7 ' + (price === null ? '' : money(price) + ' \u00b7 ') +
      (live ? 'In stock' : 'Out of stock');

    paintOptions(p, key);
    wireChips(key);
    syncChat(key, p);

    if (!live) {
      var label = p.unavailable ? 'Unavailable' : 'Out of stock';
      if (el.add) { el.add.disabled = true; el.add.textContent = label; }
      if (el.buy) { el.buy.disabled = true; el.buy.textContent = label; }
      note(p.unavailable
        ? 'This item is not in the live store catalogue right now, so it cannot be ordered.'
        : 'This item is out of stock and cannot be ordered right now.', true);
    } else {
      if (el.add) { el.add.disabled = false; el.add.textContent = 'Add to cart'; }
      if (el.buy) { el.buy.disabled = false; el.buy.textContent = 'Buy now'; }
    }

    if (stale) {
      note('The live store could not be reached just now, so the stock figure on this page may be out of date.', false);
    }
  }

  function fail(msg) {
    if (el.name) el.name.textContent = 'Product unavailable';
    if (el.desc) el.desc.textContent = msg;
    if (el.flag) el.flag.innerHTML = '<span class="badge no">\u2014</span>';
    if (el.price) el.price.textContent = '';
    if (el.meta) el.meta.innerHTML = '';
    if (el.add) { el.add.disabled = true; el.add.textContent = 'Unavailable'; }
    if (el.buy) { el.buy.disabled = true; el.buy.textContent = 'Unavailable'; }
    document.title = 'Product unavailable \u00b7 Trendy Choice';
  }

  function findProduct(key) {
    var list = (window.BKCAT && window.BKCAT.catalog) ? (window.BKCAT.catalog() || []) : (window.PRODUCTS || []);
    var found = null;
    if (key.indexOf('slug:') === 0) {
      var want = key.slice(5).toLowerCase();
      list.forEach(function (x) {
        var b = (window.BKCAT && window.BKCAT.backend) ? window.BKCAT.backend(x.id) : null;
        if (b && String(b.slug).toLowerCase() === want) found = x;
      });
      return found;
    }
    /* A product that exists only in BusinessKoro is keyed "bk:<uuid>" in the
       catalogue, but the links the shop generates carry the bare uuid
       (?p=<uuid>). Accept either, and fall back to the backend id, so a link
       written by any part of the site resolves to the same product. */
    list.forEach(function (x) {
      if (String(x.id) === String(key)) found = x;
    });
    if (found) return found;
    list.forEach(function (x) {
      if (String(x.id) === 'bk:' + key) found = x;
    });
    if (found) return found;
    list.forEach(function (x) {
      if (x.bkId && String(x.bkId) === String(key)) found = x;
    });
    return found;
  }

  function go(cart, key, p) {
    if (!window.CART) return;
    var picked = readPicked(key);
    if (window.VARIANTS) {
      Object.keys(picked).forEach(function (k) { window.VARIANTS.set(key, k, picked[k]); });
    }
    window.CART.add(p.id, 1);
    if (window.toast) window.toast('Added to cart');
    if (cart) setTimeout(function () { location.href = BASE + 'cart.html'; }, 240);
  }

  var booted = false;
  function boot() {
    if (booted) return;
    booted = true;
    grab();
    var key = pageKey();

    /* the reset happens FIRST, unconditionally, before any network call */
    clearProduct();

    if (!key) { fail('No product was requested. Open a product from the shop.'); return; }
    if (!window.BKCAT) {
      fail('The store API client did not load, so this product cannot be shown. Please reload the page.');
      return;
    }

    var addHandler = function () {
      if (!el.add || el.add.__wired) return;
      el.add.__wired = true;
      el.add.addEventListener('click', function () {
        var p = findProduct(key);
        if (p) go(false, key, p);
      });
    };
    var buyHandler = function () {
      if (!el.buy || el.buy.__wired) return;
      el.buy.__wired = true;
      el.buy.addEventListener('click', function () {
        var p = findProduct(key);
        if (p) go(true, key, p);
      });
    };
    addHandler(); buyHandler();

    window.BKCAT.load().then(function () {
      var p = findProduct(key);
      if (!p) return fail('This product is not in the live store catalogue right now.');
      var stale = !!(window.BK && window.BK.fallback);
      paint(p, key, stale);
      /* stock-filter.js may repaint the chips once it has the backend variants;
         re-render them (and the chat bubble) when it does */
      document.addEventListener('bk:stock', function () { paintOptions(p, key); syncChat(key, p); });
    }, function (err) {
      /* the catalogue is unreachable: fall back to the bundled record so the
         page is still usable, but say the stock figure may be old */
      var fallback = null;
      (window.PRODUCTS || []).forEach(function (x) { if (String(x.id) === String(key)) fallback = x; });
      if (fallback) {
        paint(fallback, key, true);
        return;
      }
      fail('The store backend could not be reached (' +
        (err && err.message ? err.message : 'network error') + '). Please try again in a moment.');
    });
  }

  /* A page restored from the back/forward cache keeps the DOM of the product
     the customer left, so re-run the reset when that happens. */
  window.addEventListener('pageshow', function (e) {
    if (!e.persisted) return;
    var key = pageKey();
    var p = key ? findProduct(key) : null;
    if (p) { grab(); clearProduct(); paint(p, key, !!(window.BK && window.BK.fallback)); }
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
