/* Trendy Choice — shared UI + cart (v4) */
(function () {
  var BASE = document.body.getAttribute('data-base') || '';
  var BRAND = 'Trendy Choice';

  var I = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V20h13V9.5"/>',
    grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>',
    cart: '<path d="M3 4h2.2l2.3 11.2a2 2 0 0 0 2 1.6h8.1a2 2 0 0 0 2-1.6L21 8H6"/><circle cx="10" cy="20" r="1.3"/><circle cx="17.5" cy="20" r="1.3"/>',
    user: '<circle cx="12" cy="8" r="3.6"/><path d="M4.8 20.5a7.2 7.2 0 0 1 14.4 0"/>',
    search: '<circle cx="10.8" cy="10.8" r="6.3"/><path d="m15.5 15.5 4.5 4.5"/>',
    right: '<path d="m9 5 7 7-7 7"/>',
    left: '<path d="m15 5-7 7 7 7"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    bolt: '<path d="M13 2 4.5 13.5H11l-1 8.5L19.5 10H13z"/>',
    wa: '<path d="M12.04 2.2a9.7 9.7 0 0 0-8.3 14.7L2.2 21.8l5-1.5a9.7 9.7 0 1 0 4.84-18.1Zm0 1.8a7.9 7.9 0 1 1-4 14.7l-.3-.18-3 .9.9-2.9-.2-.3A7.9 7.9 0 0 1 12.04 4Zm-3.2 3.9c-.2 0-.5.1-.7.4-.3.3-.9.9-.9 2s.8 2.2 1 2.4c.1.1 1.6 2.7 4 3.6 1.9.8 2.3.7 2.8.6.5 0 1.5-.6 1.7-1.2.2-.6.2-1.2.2-1.3 0-.1-.2-.2-.4-.3l-1.5-.7c-.2-.1-.4-.1-.5.1l-.7.8c-.1.2-.3.2-.5.1a6.5 6.5 0 0 1-3.2-2.8c-.1-.2 0-.3.1-.4l.5-.6c.1-.2.1-.3 0-.5l-.7-1.6c-.2-.4-.3-.4-.5-.4h-.4Z"/>',
    phone: '<path d="M6.4 3.5h2.9l1.4 3.6-2 1.3a10.6 10.6 0 0 0 5.9 5.9l1.3-2 3.6 1.4v2.9a2.2 2.2 0 0 1-2.4 2.2A16.5 16.5 0 0 1 4.2 5.9 2.2 2.2 0 0 1 6.4 3.5Z"/>',
    spark: '<path d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.4l-1.9-5.6L4.5 11 10.1 9z"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    trash: '<path d="M4 7h16"/><path d="M9 7V4.5h6V7"/><path d="M6.5 7l.9 12.5h9.2L17.5 7"/>',
    shield: '<path d="M12 3l7 2.5v6c0 4.4-3 7.6-7 9.5-4-1.9-7-5.1-7-9.5v-6z"/><path d="m9 12 2 2 4-4"/>',
    truck: '<path d="M2.8 6h10v9.5H2.8z"/><path d="M12.8 9.5h4l3.4 3V15.5h-7.4z"/><circle cx="6.6" cy="18" r="1.7"/><circle cx="17" cy="18" r="1.7"/>',
    fb: '<path d="M14.5 8.5H17V5.4h-2.6c-2.3 0-3.9 1.6-3.9 3.9v1.4H8.1v3.1h2.4V21h3.2v-7.2h2.4l.4-3.1h-2.8V9.5c0-.6.3-1 .8-1Z"/>',
    yt: '<rect x="2.6" y="5.4" width="18.8" height="13.2" rx="4"/><path d="m10.4 9.6 5 2.4-5 2.4z" fill="currentColor" stroke="none"/>',
    ig: '<rect x="3.4" y="3.4" width="17.2" height="17.2" rx="5"/><circle cx="12" cy="12" r="3.9"/><circle cx="17" cy="7" r=".9" fill="currentColor" stroke="none"/>',
    tg: '<path d="M21 4.5 2.9 11.4l4.9 1.7 1.7 5.5 2.6-3 4.2 3.1z"/><path d="m7.8 13.1 8.1-5.4-5.6 6.1"/>',
    tk: '<path d="M15 3.5v10.2a3.6 3.6 0 1 1-3.6-3.6"/><path d="M15 5.2c1 1.5 2.5 2.4 4.3 2.5"/>'
  };
  window.ICON = function (n, cls) {
    var p = I[n] || '';
    var fill = (n === 'wa');
    return '<svg class="ico ' + (fill ? 'fill ' : '') + (cls || '') +
      '" viewBox="0 0 24 24" aria-hidden="true"' +
      (fill ? ' fill="currentColor" stroke="none"' : '') + '>' + p + '</svg>';
  };

  /* ---------------- cart ---------------- */
  var CART_KEY = 'tc_cart_v3';
  function readCart() {
    try { return JSON.parse(localStorage.getItem(CART_KEY) || '{}') || {}; }
    catch (e) { return {}; }
  }
  function writeCart(c) {
    try { localStorage.setItem(CART_KEY, JSON.stringify(c)); } catch (e) { }
    paintCount();
  }
  function count() {
    var c = readCart(), n = 0;
    for (var k in c) n += c[k];
    return n;
  }
  function paintCount() {
    var n = count();
    document.querySelectorAll('[data-cart-badge]').forEach(function (b) {
      b.textContent = n;
      b.style.display = n > 0 ? '' : 'none';
    });
  }
  window.CART = {
    read: readCart, count: count,
    add: function (id, q) {
      var c = readCart(); id = String(id);
      c[id] = (c[id] || 0) + (q || 1); writeCart(c);
    },
    set: function (id, q) {
      var c = readCart(); id = String(id);
      if (q <= 0) delete c[id]; else c[id] = q;
      writeCart(c);
    },
    remove: function (id) { var c = readCart(); delete c[String(id)]; writeCart(c); },
    clear: function () { writeCart({}); }
  };

  function money(n) {
    return '\u09F3' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
  }
  window.money = money;
  window.assetBase = BASE;

  /* ---------------- variant capture (additive) ----------------
     Product pages render .opt-chip buttons (data-g / data-v). Remember the
     customer's pick per product so the checkout can show "Size: L, Color: Black". */
  var VAR_KEY = 'tc_variants_v1';
  function readVars() {
    try { return JSON.parse(localStorage.getItem(VAR_KEY) || '{}') || {}; }
    catch (e) { return {}; }
  }
  function writeVars(v) {
    try { localStorage.setItem(VAR_KEY, JSON.stringify(v)); } catch (e) { }
  }
  function pagePid() {
    var m = /\/p(\d+)\.html(?:$|[?#])/.exec(location.pathname);
    return m ? m[1] : null;
  }
  window.VARIANTS = {
    read: readVars,
    get: function (id) { return readVars()[String(id)] || {}; },
    text: function (id) {
      var v = readVars()[String(id)] || {}, parts = [];
      Object.keys(v).forEach(function (k) { if (v[k]) parts.push(k + ': ' + v[k]); });
      return parts.join(', ');
    },
    set: function (id, group, value) {
      var all = readVars(), k = String(id);
      all[k] = all[k] || {};
      all[k][group] = value;
      writeVars(all);
    }
  };
  function initVariants() {
    var pid = pagePid();
    if (!pid) return;
    var chips = [].slice.call(document.querySelectorAll('.opt-chip'));
    if (!chips.length) return;
    var all = readVars(), saved = all[pid] || {};
    chips.forEach(function (c) {
      var g = c.getAttribute('data-g'), v = c.getAttribute('data-v');
      if (saved[g]) c.setAttribute('aria-pressed', saved[g] === v ? 'true' : 'false');
      else if (c.getAttribute('aria-pressed') === 'true') saved[g] = v;
    });
    all[pid] = saved;
    writeVars(all);
    document.addEventListener('click', function (e) {
      var t = e.target;
      var c = t && t.closest ? t.closest('.opt-chip') : null;
      if (!c) return;
      window.VARIANTS.set(pid, c.getAttribute('data-g'), c.getAttribute('data-v'));
    });
  }

  /* ---------------- header ---------------- */
  var HR = { idx: 'index.html', shop: 'products.html', cart: 'cart.html', acc: 'account.html' };

  function avatarSVG() {
    return '<svg viewBox="0 0 48 48" aria-hidden="true">' +
      '<defs><linearGradient id="avg" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="#ffd9a8"/><stop offset=".55" stop-color="#ff9ec7"/>' +
      '<stop offset="1" stop-color="#9d8bff"/></linearGradient></defs>' +
      '<rect width="48" height="48" fill="url(#avg)"/>' +
      '<circle cx="24" cy="19" r="8" fill="#3a2154" opacity=".9"/>' +
      '<path d="M8 46c1.6-8.4 8-13 16-13s14.4 4.6 16 13z" fill="#3a2154" opacity=".9"/>' +
      '<circle cx="20.4" cy="18.4" r="1.5" fill="#fff"/><circle cx="27.6" cy="18.4" r="1.5" fill="#fff"/>' +
      '<path d="M21 23.2c1.8 1.6 4.2 1.6 6 0" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round"/>' +
      '</svg>';
  }

  /* header: the supplied logo image only (no text), then ONE search + ONE cartoon avatar */
  function headerHTML() {
    return '<div class="topbar"><div class="topbar-in">' +
      '<a class="brand" href="' + BASE + HR.idx + '" aria-label="' + BRAND + ' home">' +
      '<img class="brand-mark" src="' + BASE + 'assets/logo.png" alt="' + BRAND + '">' +
      '</a>' +
      '<div class="top-actions">' +
      '<button class="icon-btn" data-search aria-label="Search products">' + ICON('search') + '</button>' +
      '<a class="avatar" href="' + BASE + HR.acc + '" aria-label="Your account">' + avatarSVG() + '</a>' +
      '</div></div></div>';
  }

  function dockHTML(active) {
    var items = [
      { k: 'home', href: BASE + HR.idx, icon: 'home', label: 'Home' },
      { k: 'shop', href: BASE + HR.shop, icon: 'grid', label: 'Shop' },
      { k: 'cart', href: BASE + HR.cart, icon: 'cart', label: 'Cart' },
      { k: 'acc', href: BASE + HR.acc, icon: 'user', label: 'Account' }
    ];
    var h = '<nav class="dock" aria-label="Main">';
    items.forEach(function (it) {
      var cur = it.k === active ? ' aria-current="page"' : '';
      h += '<a href="' + it.href + '"' + cur + '><span class="cartwrap">' + ICON(it.icon) +
        (it.k === 'cart' ? '<i class="cart-badge" data-cart-badge style="display:none">0</i>' : '') +
        '</span><span>' + it.label + '</span></a>';
    });
    return h + '</nav>';
  }

  function footerHTML() {
    return '<div class="wrap"><div class="foot-shell glass">' +
      '<div class="foot-top">' +
        '<div class="foot-col">' +
          '<div class="foot-brand"><span class="brand-logo">' +
            '<img src="' + BASE + 'assets/logo.png" alt="" width="38" height="38"></span>' +
            '<span><b>' + BRAND + '</b><span>Trusted store</span></span></div>' +
          '<p class="foot-desc">Genuine gadgets and lifestyle products at the best price — ' +
            'delivered all over Bangladesh.</p>' +
        '</div>' +
        '<div class="foot-cols">' +
          '<div class="foot-col"><h3>Contact</h3><ul>' +
            '<li><a href="' + BASE + 'account.html#contact">Help Center</a></li>' +
            '<li><a href="' + BASE + 'account.html#contact">Live Chat</a></li>' +
            '<li><a href="tel:+8801826459122">Call us</a></li>' +
            '<li><a href="https://wa.me/8801826459122" target="_blank" rel="noopener">WhatsApp</a></li>' +
          '</ul></div>' +
          '<div class="foot-col"><h3>Services</h3><ul>' +
            '<li><a href="' + BASE + 'account.html#help">Shipping</a></li>' +
            '<li><a href="' + BASE + 'account.html#help">Returns</a></li>' +
            '<li><a href="' + BASE + 'account.html#help">Order Tracking</a></li>' +
            '<li><a href="' + BASE + 'account.html#help">Payment</a></li>' +
          '</ul></div>' +
          '<div class="foot-col"><h3>Product</h3><ul>' +
            '<li><a href="' + BASE + HR.shop + '">Shop All</a></li>' +
            '<li><a href="' + BASE + HR.idx + '">New Arrivals</a></li>' +
            '<li><a href="' + BASE + HR.shop + '">Best Sellers</a></li>' +
            '<li><a href="' + BASE + HR.cart + '">Your Cart</a></li>' +
          '</ul></div>' +
          '<div class="foot-col"><h3>Company</h3><ul>' +
            '<li><a href="' + BASE + 'account.html#about">About Us</a></li>' +
            '<li><a href="' + BASE + 'account.html#contact">Contact</a></li>' +
            '<li><a href="' + BASE + 'account.html#help">FAQ</a></li>' +
            '<li><a href="' + BASE + 'account.html#help">Privacy</a></li>' +
          '</ul></div>' +
        '</div>' +
      '</div>' +
      '<div class="foot-socials">' +
        '<a class="fsoc" href="https://www.facebook.com/trendychoicexyz" target="_blank" rel="noopener" aria-label="Facebook">' + ICON('fb') + '</a>' +
        '<a class="fsoc wa" href="https://wa.me/8801826459122" target="_blank" rel="noopener" aria-label="WhatsApp">' + ICON('wa') + '</a>' +
        '<span class="fsoc soon" aria-label="Instagram (link coming soon)" title="Instagram \u2014 link coming soon">' + ICON('ig') + '</span>' +
        '<span class="fsoc soon" aria-label="YouTube (link coming soon)" title="YouTube \u2014 link coming soon">' + ICON('yt') + '</span>' +
        '<span class="fsoc soon" aria-label="Telegram (link coming soon)" title="Telegram \u2014 link coming soon">' + ICON('tg') + '</span>' +
      '</div>' +
      '<div class="pay-strip"><h3>We accept</h3><div class="pays">' +
        '<div class="pay bkash"><span>bKash</span></div>' +
        '<div class="pay nagad"><span>Nagad</span></div>' +
        '<div class="pay rocket"><span>Rocket</span></div>' +
        '<div class="pay upay"><span>Upay</span></div>' +
        '<div class="pay cod"><span>COD</span></div>' +
      '</div></div>' +
      '<div class="foot-bottom"><span>&copy; 2026 ' + BRAND + '. All Rights Reserved.</span>' +
        ICON('spark') + '</div>' +
      '</div></div>';
  }

  /* ---------------- toast ---------------- */
  var toastEl;
  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.style.cssText = 'position:fixed;left:50%;bottom:calc(96px + env(safe-area-inset-bottom,0px));' +
        'transform:translate(-50%,10px);z-index:120;padding:10px 16px;border-radius:14px;font-size:12.5px;' +
        'font-weight:600;color:#fff;background:rgba(24,14,52,.95);border:1px solid rgba(255,255,255,.22);' +
        'box-shadow:0 14px 34px rgba(0,0,0,.5);opacity:0;transition:.22s;pointer-events:none;' +
        'max-width:86vw;text-align:center';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.style.opacity = '1';
    toastEl.style.transform = 'translate(-50%,0)';
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(function () {
      toastEl.style.opacity = '0';
      toastEl.style.transform = 'translate(-50%,10px)';
    }, 1750);
  }
  window.toast = toast;

  /* ---------------- small search sheet ---------------- */
  function searchSheet() {
    var wrap = document.createElement('div');
    wrap.className = 'sheet';
    wrap.innerHTML = '<div class="sheet-card" role="dialog" aria-modal="true" aria-label="Search products">' +
      '<div class="sheet-in">' + ICON('search') +
      '<input id="q" type="search" placeholder="Search products\u2026" autocomplete="off" enterkeyhint="search">' +
      '<button class="sheet-close" aria-label="Close">' + ICON('close') + '</button></div>' +
      '<div class="sheet-results"><div class="res-empty">Type to search products.</div></div></div>';
    document.body.appendChild(wrap);

    var input = wrap.querySelector('#q');
    var out = wrap.querySelector('.sheet-results');

    function esc(s) {
      return String(s).replace(/[&<>"]/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
      });
    }
    function render() {
      var q = input.value.trim().toLowerCase();
      /* read window.PRODUCTS at call time: assets/stock-filter.js removes
         out-of-stock items from it before search is ever used */
      var list = (window.PRODUCTS || []);
      if (!q) {
        out.innerHTML = '<div class="res-empty">Type to search products.</div>';
        return;
      }
      var hits = list.filter(function (p) {
        return (p.t + ' ' + p.c).toLowerCase().indexOf(q) > -1;
      }).slice(0, 24);
      if (!hits.length) {
        out.innerHTML = '<div class="res-empty">No match for \u201C' + esc(input.value.trim()) + '\u201D</div>';
        return;
      }
      out.innerHTML = hits.map(function (p) {
        return '<a class="res" href="' + BASE + 'product/p' + p.id + '.html">' +
          '<img src="' + BASE + p.i + '" alt="" loading="lazy">' +
          '<span class="tx"><b>' + esc(p.t) + '</b><span>' + esc(p.c) + '</span></span>' +
          '<span class="pr">' + money(p.p) + '</span></a>';
      }).join('');
    }
    input.addEventListener('input', render);
    wrap.querySelector('.sheet-close').addEventListener('click', close);
    wrap.addEventListener('click', function (e) { if (e.target === wrap) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
    function open() { wrap.classList.add('open'); render(); setTimeout(function () { input.focus(); }, 60); }
    function close() { wrap.classList.remove('open'); }
    return { open: open, close: close };
  }

  /* ---------------- delegated add-to-cart ---------------- */
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('[data-add]') : null;
    if (!b || b.disabled) return;
    e.preventDefault(); e.stopPropagation();
    window.CART.add(b.getAttribute('data-add'), 1);
    toast('Added to cart');
  });

  /* ---------------- auto-scrolling "Our Product" rail ---------------- */
  function initMarquee() {
    var host = document.getElementById('mqRail');
    if (!host || !window.PRODUCTS) return;
    var picks = window.PRODUCTS.filter(function (p) { return !p.hidden; }).slice(0, 18);
    function card(p) {
      return '<a class="mq-card" href="' + BASE + 'product/p' + p.id + '.html" ' +
        'aria-label="' + (p.t || '').replace(/"/g, '&quot;') + '">' +
        '<span class="ph">' + (p.s <= 0 ? '<span class="oos">Out of stock</span>' : '') +
        '<img src="' + BASE + p.i + '" alt="" loading="lazy"></span></a>';
    }
    var one = picks.map(card).join('');
    /* duplicate the set so the -50% keyframe loops seamlessly */
    host.innerHTML = '<div class="mq-track">' + one + one + '</div>';
  }

  /* ---------------- hero : two 16:9 banners, auto-rotating every 4.5s ---------------- */
  function initHero() {
    var host = document.getElementById('heroSlides');
    if (!host) return;
    var imgs = host.querySelectorAll('img');
    if (imgs.length < 2) return;
    var i = 0;
    setInterval(function () {
      imgs[i].classList.remove('on');
      i = (i + 1) % imgs.length;
      imgs[i].classList.add('on');
    }, 4500);
  }

  /* ---------------- boot ---------------- */
  function boot() {
    var headHost = document.getElementById('siteHeader');
    if (headHost) headHost.innerHTML = headerHTML();

    document.querySelectorAll('[data-footer]').forEach(function (f) {
      f.className = 'site-foot';
      f.innerHTML = footerHTML();
    });

    var dockHost = document.getElementById('siteDock');
    if (dockHost) dockHost.innerHTML = dockHTML(dockHost.getAttribute('data-active') || '');

    initMarquee();
    initHero();
    initVariants();

    var sheet = searchSheet();
    document.querySelectorAll('[data-search]').forEach(function (b) {
      b.addEventListener('click', sheet.open);
    });

    paintCount();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
