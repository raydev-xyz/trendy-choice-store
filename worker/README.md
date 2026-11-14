# BusinessKoro storefront proxy (Cloudflare Worker)

Keeps `BK_API_KEY` out of the browser. The static storefront calls this Worker;
the Worker adds `x-api-key` server-side and forwards to the BusinessKoro API.

| Route | Upstream |
|---|---|
| `GET /products` | `GET {BASE}/products` |
| `POST /orders` | `POST {BASE}/orders` |
| `GET /orders/:id` | `GET {BASE}/orders/:id` |
| `GET /health` | config check (no key echoed) |

Responses are the real upstream status and body, passed through unchanged.
`ALLOWED_ORIGINS` pins which site origins may call it.

## Deploy

```bash
npx wrangler deploy
npx wrangler secret put BK_API_KEY   # paste the storefront key
```

Uploading a script clears existing secrets — re-set `BK_API_KEY` after every deploy.
