/* Trendy Choice — BusinessKoro catalogue bridge
   ------------------------------------------------------------------
   Maps the storefront's local product ids (1..72, used by the product
   pages and the cart) onto the REAL BusinessKoro product ids, and
   exposes the real catalogue for stock/price display.

   The mapping is by product NAME, verified against the live backend:
   all 49 backend products match a local product name exactly, and the
   local size/colour options match the backend variants exactly.

   Nothing here invents data. If the backend cannot be reached, the
   storefront keeps working from the bundled catalogue for BROWSING,
   but the checkout refuses to place an order and says why — it never
   reports a fake success.
*/
(function () {
  var MAP = null;          /* localId -> backend product */
  var READY = null;        /* promise */
  var LAST_ERROR = null;

  function norm(s) {
    return String(s || '').toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function build(products) {
    var byName = {};
    products.forEach(function (p) { byName[norm(p.name)] = p; });
    var map = {};
    (window.PRODUCTS || []).forEach(function (lp) {
      var bp = byName[norm(lp.t)];
      if (bp) map[String(lp.id)] = bp;
    });
    return map;
  }

  /* Load the real catalogue once. Resolves with the map; rejects with the
     real error so callers can show the true status instead of hiding it. */
  function load() {
    if (READY) return READY;
    READY = window.BK.products().then(function (res) {
      MAP = build(res.products);
      LAST_ERROR = null;
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
    get error() { return LAST_ERROR; },
    /* backend product for a local id, or null if not in the backend */
    backend: function (localId) { return MAP ? (MAP[String(localId)] || null) : null; },
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
