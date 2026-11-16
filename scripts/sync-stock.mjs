#!/usr/bin/env node
/* Trendy Choice — stock snapshot sync
   ------------------------------------------------------------------
   Fetches the live BusinessKoro catalogue through the Cloudflare Worker
   proxy and writes data/stock.json, the committed snapshot the storefront
   falls back to when the API cannot be reached.

   Run by .github/workflows/stock-sync.yml every 30 minutes. It can also be
   run by hand:  node scripts/sync-stock.mjs

   Nothing is invented: every number here comes from the API response. If the
   API fails the script exits non-zero and the previous snapshot is left
   untouched, so a bad run can never publish an empty catalogue.
*/

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKER = process.env.STOCK_API || 'https://trendy.r4ydevbd.workers.dev';
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '..', 'data', 'stock.json');

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function main() {
  const url = WORKER.replace(/\/+$/, '') + '/products';
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(30000)
  });
  if (!res.ok) {
    throw new Error(`GET ${url} -> HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  const body = await res.json();
  const list = Array.isArray(body) ? body : (body.data || []);
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error('API returned no products — refusing to overwrite the snapshot');
  }

  const products = list.map((p) => {
    const qty = num(p.stockQuantity);
    return {
      id: p.id,
      slug: p.slug || null,
      name: p.name,
      price: num(p.suggestedPrice),
      stock: qty,
      inStock: p.inStock !== false && qty > 0,
      variants: (p.variants || []).map((v) => ({
        color: v.color || null,
        size: v.size || null,
        stock: num(v.stockQuantity),
        inStock: v.inStock !== false && num(v.stockQuantity) > 0
      }))
    };
  });

  const sellable = products.filter((p) => p.inStock);
  const snapshot = {
    generatedAt: new Date().toISOString(),
    source: url,
    total: products.length,
    sellable: sellable.length,
    outOfStock: products.length - sellable.length,
    products
  };

  await mkdir(dirname(OUT), { recursive: true });

  let previous = null;
  try { previous = JSON.parse(await readFile(OUT, 'utf8')); } catch { /* first run */ }

  const same = previous &&
    previous.total === snapshot.total &&
    previous.sellable === snapshot.sellable &&
    JSON.stringify(previous.products) === JSON.stringify(snapshot.products);

  if (same) {
    console.log(`No change: ${snapshot.sellable}/${snapshot.total} sellable. Snapshot left as is.`);
    return;
  }

  await writeFile(OUT, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
  console.log(`Wrote ${OUT}`);
  console.log(`  total ${snapshot.total} | sellable ${snapshot.sellable} | out of stock ${snapshot.outOfStock}`);
  for (const p of products.filter((x) => !x.inStock)) {
    console.log(`  OUT OF STOCK  ${p.name.slice(0, 70)}`);
  }
}

main().catch((err) => {
  console.error('stock sync failed:', err.message);
  process.exit(1);
});
