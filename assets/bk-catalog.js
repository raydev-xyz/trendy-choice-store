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
      return !p.unavailable && Number(p.s) > 0;
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

    READY = window.BK.products().then(function (res) {
      RAW = res.products;
      MAP = build(res.products);
      MERGED = merge(res.products, MAP);
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
