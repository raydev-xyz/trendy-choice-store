# Trendy Choice — Storefront

Glassmorphism storefront for Trendy Choice, with a real checkout backed by the
BusinessKoro Storefront API.

## Pages

| Page | Path |
|---|---|
| Home | `index.html` |
| Products | `products.html` |
| Product detail | `product/p1.html` … `product/p72.html` |
| Cart | `cart.html` |
| Checkout | `checkout.html` |
| Account | `account.html` |

## Backend

The browser never holds an API key. All BusinessKoro calls go through a
Cloudflare Worker that adds the `x-api-key` header server-side:

```
https://trendy.r4ydevbd.workers.dev
  GET  /products      -> GET  {BASE}/products
  POST /orders        -> POST {BASE}/orders
  GET  /orders/:id    -> GET  {BASE}/orders/:id
  GET  /health        -> config sanity check
```

`BASE` is `https://api.businesskoro.com/api/v1/storefront`.

The Worker's `BK_API_KEY` is a Cloudflare **secret** and is not in this
repository. `BK_API_BASE_URL` is a plain-text variable.

### Checkout behaviour

- Submits a real `POST /orders`; there is no mock or fake success path.
- Shows the real order id / order number on success.
- On failure shows the real HTTP status and the API's own error message.
- One order = one unit (the API ignores `quantity`), so a cart with N items
  sends N separate requests.
- Size and colour selected on the product page are carried through to the order.
- Prices and delivery charges come from the API, not from hardcoded values.

### Stock

Products with `stockQuantity <= 0` or `inStock === false` are hidden from the
home grid, the "Our Product" rail, the products page and search results. Stock
is read from the live `GET /products` response.

## Local preview

Any static server works, e.g.:

```bash
python3 -m http.server 8000
```

The Worker only allows the origins listed in its `ALLOWED_ORIGINS` array, so a
local origin will be blocked by CORS until it is added there.

## Deploying the Worker

```bash
cd worker
npx wrangler deploy
npx wrangler secret put BK_API_KEY
```

Note: uploading a script clears existing secrets — re-set `BK_API_KEY` after
every deploy.
