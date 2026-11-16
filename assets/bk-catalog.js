/* Trendy Choice — BusinessKoro catalogue bridge
   ------------------------------------------------------------------
   Maps the storefront's local product ids (1..72, used by the product
   pages and the cart) onto the REAL BusinessKoro product ids, and
   exposes the real catalogue for stock/price display.

   Matching is by SLUG first, then by normalised name, then by token
   similarity. Name-only matching used to drop products whose local
   title differed from the backend title by a single character (for
   example "Hoco GA6" vs the backend's "Hoco CA6"), so slug matching is
   the primary key now and a name mismatch no longer hides a product.

   The live backend currently lists 53 products. 50 of them match a
   local product; the other 3 are new in BusinessKoro and are added to
   the storefront automatically (see merge()).

   Nothing here invents data. If the backend cannot be reached, the
   storefront keeps working from the bundled catalogue for BROWSING,
   but the checkout refuses to place an order and says why — it never
   reports a fake success.
*/
(function () {
  var MAP = null;          /* localId -> backend product */
  var BY_BK = null;        /* backend uuid -> backend product */
  var RAW = null;          /* the backend's own list, unmerged */
  var MERGED = null;       /* the live catalogue the storefront renders */
  var ORIGINAL = null;     /* the bundled window.PRODUCTS, captured once */
  var READY = null;        /* promise */
  var LAST_ERROR = null;
  var CHARGES = null;

  /* ---------------- text helpers ---------------- */

  function norm(s) {
    return String(s || '').toLowerCase()
      .replace(/&amp;/g, ' and ')
      .replace(/[^a-z0-9\u0980-\u09FF]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function slugify(s) {
    return String(s || '').toLowerCase()
      .replace(/&amp;/g, ' and ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function tokens(s) {
    return norm(s).split(' ').filter(function (t) { return t.length > 1; });
  }

  function jaccard(a, b) {
    var A = tokens(a), B = tokens(b);
    if (!A.length || !B.length) return 0;
    var seen = {}, inter = 0;
    A.forEach(function (t) { seen[t] = 1; });
    B.forEach(function (t) { if (seen[t]) inter++; });
    return inter / (A.length + B.length - inter);
  }

  /* ---------------- matching ---------------- */

  /* Find the backend product for one local product.
     Order: exact slug -> exact name -> slug prefix -> token similarity. */
  function matchOne(localProduct, products) {
    if (!localProduct) return null;
    var list = products || (BY_BK ? Object.keys(BY_BK).map(function (k) { return BY_BK[k]; }) : []);
    var s = slugify(localProduct.t);
    var n = norm(localProduct.t);
    var i, p;

    for (i = 0; i < list.length; i++) {
      if (list[i].slug === s) return list[i];
    }
    for (i = 0; i < list.length; i++) {
      if (norm(list[i].name) === n) return list[i];
    }
    /* slug prefix / containment — catches a trailing "(original)" or a
       truncated backend slug */
    var best = null, bestLen = 0;
    if (s.length > 12) {
      for (i = 0; i < list.length; i++) {
        p = list[i];
        if (p.slug && (p.slug.indexOf(s) === 0 || s.indexOf(p.slug) === 0)) {
          var L = Math.min(p.slug.length, s.length);
          if (L > bestLen) { bestLen = L; best = p; }
        }
      }
    }
    if (best) return best;

    /* token similarity — last resort, needs a strong overlap */
    var bs = 0, bp = null;
    for (i = 0; i < list.length; i++) {
      var sc = jaccard(localProduct.t, list[i].name);
      if (sc > bs) { bs = sc; bp = list[i]; }
    }
    return bs >= 0.62 ? bp : null;
  }

  function build(products) {
    var map = {}, byBk = {};
    products.forEach(function (p) { byBk[p.id] = p; });
    (ORIGINAL || []).forEach(function (lp) {
      var bp = matchOne(lp, products);
      if (bp) map[String(lp.id)] = bp;
    });
    BY_BK = byBk;
    return map;
  }

  /* ---------------- merged catalogue ---------------- */

  function variantOptions(bp) {
    var groups = {}, order = [];
    (bp.variants || []).forEach(function (v) {
      if (v.size) {
        if (!groups.Size) { groups.Size = []; order.push('Size'); }
        if (groups.Size.indexOf(v.size) === -1) groups.Size.push(v.size);
      }
      if (v.color) {
        if (!groups.Color) { groups.Color = []; order.push('Color'); }
        if (groups.Color.indexOf(v.color) === -1) groups.Color.push(v.color);
      }
    });
    return order.map(function (k) { return { n: k, v: groups[k] }; });
  }

  /* ---- storefront visibility ------------------------------------------------
     Owner's rule: a product that cannot be sold is not shown in the shop.
     "Cannot be sold" means exactly one thing — the backend reports no stock
     (stockQuantity 0 or inStock false), or the product is not in the live
     catalogue at all (unavailable). Both are dropped from the rendered list
     here; they are NOT deleted from the catalogue, so the cart and checkout
     can still recognise an id someone saved earlier.

     Set window.BKCAT.showUnavailable = true (before the grid paints) to list
     them again with their badge — useful when auditing the catalogue. */
  function sellable(list) {
    if (window.BKCAT && window.BKCAT.showUnavailable) return list;
    return list.filter(function (p) {
      if (p.unavailable || p.inactive || !(Number(p.s) > 0)) return false;
      /* the owner's own decision, made in the admin panel, wins over the
         backend: a product they hid is not shown even if it is in stock */
      if (window.STORE && window.STORE.isHidden && window.STORE.isHidden(p.id)) return false;
      return true;
    });
  }

  /* Apply the admin panel's decisions to the merged catalogue: price
     overrides, then the pin order. Both are no-ops when the owner has not
     touched anything, so the shop looks exactly as it did before. */
  function applyStore(list) {
    if (!window.STORE) return list;
    var out = list.map(function (p) {
      var override = window.STORE.priceOf ? window.STORE.priceOf(p.id) : null;
      if (override === null || !isFinite(override)) return p;
      var copy = {};
      Object.keys(p).forEach(function (k) { copy[k] = p[k]; });
      copy.p = override;
      copy.priceOverridden = true;
      return copy;
    });
    out = applyFlashSale(out);
    return window.STORE.order ? window.STORE.order(out) : out;
  }

  /* A flash sale is a time-boxed percentage the owner switches on in the
     panel. It only ever lowers a price, and only while the clock is inside
     the window — an expired sale silently stops applying, so a forgotten
     switch cannot leave the shop selling at a discount forever. */
  function applyFlashSale(list) {
    var fs = window.STORE && window.STORE.flashSale ? window.STORE.flashSale() : null;
    if (!fs || !fs.active || !(fs.percent > 0)) return list;
    if (fs.endsAt) {
      var end = new Date(fs.endsAt).getTime();
      if (isFinite(end) && Date.now() > end) return list;
    }
    var ids = fs.ids || [];
    if (!ids.length) return list;
    return list.map(function (p) {
      if (ids.indexOf(String(p.id)) === -1) return p;
      var sale = Math.max(1, Math.round(p.p * (100 - fs.percent) / 100));
      if (!(sale < p.p)) return p;
      var c = {};
      Object.keys(p).forEach(function (k) { c[k] = p[k]; });
      c.was = p.p;
      c.p = sale;
      c.flashSale = true;
      c.flashLabel = fs.label || 'Flash sale';
      return c;
    });
  }

  /* ---- the owner's product edits ------------------------------------------
     The admin panel can rename a product, change its price, set its stock,
     swap its photos, mark it featured or take it off the shelf. Those edits
     live in the settings service keyed by the same product id the shop uses,
     and are applied here — after the backend merge, before the grid paints —
     so the shop and the panel never disagree about a product.

     An override never invents a product: it only edits one that the backend
     already lists. A product the backend does not have stays unavailable no
     matter what an override says, because there is nothing to sell. */
  function applyOverrides(list, map) {
    if (!map || typeof map !== 'object') return list;
    return list.map(function (p) {
      var o = map[String(p.id)];
      if (!o || typeof o !== 'object') return p;
      var c = {};
      Object.keys(p).forEach(function (k) { c[k] = p[k]; });

      if (typeof o.name === 'string' && o.name.trim()) c.t = o.name.trim();
      if (typeof o.description === 'string' && o.description.trim()) c.d = o.description;
      if (typeof o.category === 'string' && o.category.trim()) c.c = o.category;
      if (typeof o.sku === 'string' && o.sku.trim()) c.sku = o.sku;
      if (typeof o.brand === 'string' && o.brand.trim()) c.brand = o.brand;
      if (typeof o.tags === 'string' && o.tags.trim()) c.tags = o.tags;

      if (o.price !== undefined && isFinite(Number(o.price)) && Number(o.price) > 0) {
        c.p = Math.round(Number(o.price));
        c.priceOverridden = true;
      }
      if (o.discountPrice !== undefined && isFinite(Number(o.discountPrice)) && Number(o.discountPrice) > 0) {
        c.was = c.p;
        c.p = Math.round(Number(o.discountPrice));
        c.priceOverridden = true;
      }
      if (o.stock !== undefined && isFinite(Number(o.stock))) {
        c.s = Math.max(0, Math.round(Number(o.stock)));
        c.stockOverridden = true;
      }
      if (Array.isArray(o.images) && o.images.length) {
        c.i = o.images[0];
        c.big = o.images[0];
        c.images = o.images.slice();
      }
      if (Array.isArray(o.variants) && o.variants.length) {
        var groups = {}, order = [];
        o.variants.forEach(function (v) {
          if (v.size) {
            if (!groups.Size) { groups.Size = []; order.push('Size'); }
            if (groups.Size.indexOf(v.size) === -1) groups.Size.push(v.size);
          }
          if (v.color) {
            if (!groups.Color) { groups.Color = []; order.push('Color'); }
            if (groups.Color.indexOf(v.color) === -1) groups.Color.push(v.color);
          }
        });
        if (order.length) c.opts = order.map(function (k) { return { n: k, v: groups[k] }; });
      }
      if (o.featured === true) c.featured = true;
      if (o.active === false || o.status === 'inactive') c.inactive = true;
      return c;
    });
  }

  /* Build the list the storefront renders.
     Order is preserved: every bundled product keeps its card and its id
     (that is what the cart, the product pages and the checkout key on),
     then any backend product with no local counterpart is appended, so a
     product added in BusinessKoro shows up without editing the HTML.
     A bundled product the backend does not list is kept visible but
     marked unavailable rather than deleted on a name mismatch. */
  function merge(products, map) {
    var out = [];
    var byBkId = {}, matchedBk = {};

    products.forEach(function (bp) { byBkId[bp.id] = bp; });

    (ORIGINAL || []).forEach(function (lp) {
      var bp = map[String(lp.id)];
      if (bp) {
        matchedBk[bp.id] = 1;
        out.push({
          id: lp.id,
          t: lp.t,
          c: lp.c,
          p: bp.suggestedPrice,
          s: bp.stockQuantity,
          i: lp.i,
          big: lp.big || lp.i,
          d: lp.d,
          opts: lp.opts,
          bkId: bp.id,
          href: 'product/p' + lp.id + '.html'
        });
      } else {
        out.push({
          id: lp.id,
          t: lp.t,
          c: lp.c,
          p: lp.p,
          s: 0,
          i: lp.i,
          big: lp.big || lp.i,
          d: lp.d,
          opts: lp.opts,
          unavailable: true,
          href: 'product/p' + lp.id + '.html'
        });
      }
    });

    /* backend products the storefront has no local entry for */
    products.forEach(function (bp) {
      if (matchedBk[bp.id]) return;
      out.push({
        id: 'bk:' + bp.id,
        t: bp.name,
        c: bp.category || 'Shop',
        p: bp.suggestedPrice,
        s: bp.stockQuantity,
        i: bp.image,
        big: bp.image,
        d: bp.description || '',
        opts: variantOptions(bp),
        bkId: bp.id,
        href: 'product/view.html?p=' + encodeURIComponent(bp.id)
      });
    });

    return out;
  }

  /* ---------------- load ---------------- */

  function load() {
    if (READY) return READY;
    if (!ORIGINAL) ORIGINAL = (window.PRODUCTS || []).slice();

    /* The owner's settings and the catalogue are two independent requests.
       Wait for the settings FIRST: the overrides they carry are applied while
       the catalogue is built, so a price or name the owner changed is already
       in place on the first paint instead of flickering in afterwards. */
    var settings = (window.STORE && window.STORE.ready) ? window.STORE.ready : Promise.resolve(null);

    READY = settings.then(function () {
      return window.BK.products();
    }).then(function (res) {
      RAW = res.products;
      MAP = build(res.products);
      MERGED = merge(res.products, MAP);
      /* the owner's per-product edits, then price overrides and pin order */
      if (window.STORE && window.STORE.overrides) {
        MERGED = applyOverrides(MERGED, window.STORE.overrides());
      }
      MERGED = applyStore(MERGED);
      CHARGES = res.deliveryCharges || null;
      window.BKCAT.liveCount = res.products.length;
      window.BKCAT.matchedCount = Object.keys(MAP).length;
      /* the whole storefront (grid, search, marquee, cart, checkout) reads
         window.PRODUCTS, so point it at the live catalogue */
      window.PRODUCTS = MERGED;
      LAST_ERROR = null;
      try {
        document.dispatchEvent(new CustomEvent('bk:catalog', { detail: { products: MERGED } }));
      } catch (e) { /* very old browser: callers still get the promise */ }
      return MAP;
    }, function (err) {
      LAST_ERROR = err;
      READY = null;          /* allow a retry on the next call */
      throw err;
    });
    return READY;
  }

  window.BKCAT = {
    load: load,
    matchOne: matchOne,
    get error() { return LAST_ERROR; },
    get lastCharges() { return CHARGES; },
    /* the live merged catalogue, or the bundled one before it loads */
    catalog: function () { return MERGED || window.PRODUCTS || []; },
    /* only what can actually be sold — what the shop renders */
    sellable: function () { return sellable(this.catalog()); },
    /* the backend's own product list (unmerged), or null before it loads */
    raw: function () { return RAW; },
    /* backend product for a local id (or a 'bk:<uuid>' id), or null */
    backend: function (localId) {
      var k = String(localId);
      if (k.indexOf('bk:') === 0) return BY_BK ? (BY_BK[k.slice(3)] || null) : null;
      return MAP ? (MAP[k] || null) : null;
    },
    /* real stock for a local id; null when unknown */
    stock: function (localId) {
      var b = this.backend(localId);
      return b ? b.stockQuantity : null;
    },
    /* real price for a local id; falls back to the bundled price only for
       display before the catalogue has loaded */
    price: function (localId, fallback) {
      var b = this.backend(localId);
      return b ? b.suggestedPrice : fallback;
    },
    /* sizes / colours the backend actually accepts for a local id */
    sizes: function (localId) {
      var b = this.backend(localId);
      if (!b) return [];
      var out = [];
      (b.variants || []).forEach(function (v) {
        if (v.size && out.indexOf(v.size) === -1) out.push(v.size);
      });
      return out;
    },
    colors: function (localId) {
      var b = this.backend(localId);
      if (!b) return [];
      var out = [];
      (b.variants || []).forEach(function (v) {
        if (v.color && out.indexOf(v.color) === -1) out.push(v.color);
      });
      return out;
    }
  };
})();
