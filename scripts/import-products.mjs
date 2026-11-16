// Bulk-add products to the Ageless shop through the admin API (same rules as adding them in the admin).
// Usage (Node 18+):
//   AGELESS_URL=https://ageless-4dq.pages.dev AGELESS_EMAIL=you@example.com AGELESS_PASSWORD='…' node scripts/import-products.mjs products.json
// products.json is an array like:
//   [{ "name": "Gojo Figure", "category": "Figures", "description": "…", "featured": false, "status": "active",
//      "variations": [{ "name": "Regular", "price": "39.99", "stock": 3, "sku": "FIG-GOJO" }],
//      "photos": ["photos/gojo-1.jpg", "photos/gojo-2.jpg"] }]
// The password is read from the environment only and is never stored.
import { readFile } from 'node:fs/promises';
import { basename, extname, resolve, dirname } from 'node:path';

const base = (process.env.AGELESS_URL || '').replace(/\/$/, ''), email = process.env.AGELESS_EMAIL, password = process.env.AGELESS_PASSWORD;
const file = process.argv[2];
if (!base || !email || !password || !file) { console.error('Set AGELESS_URL, AGELESS_EMAIL, AGELESS_PASSWORD and pass a products JSON file.'); process.exit(1); }
let cookie = '';
async function call(path, opts = {}) {
  const r = await fetch(base + '/api' + path, { ...opts, headers: { 'X-Ageless-Admin': '1', ...(cookie ? { Cookie: cookie } : {}), ...(opts.json ? { 'Content-Type': 'application/json' } : {}), ...opts.headers }, body: opts.json ? JSON.stringify(opts.json) : opts.body });
  const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${path}: ${j.error || r.status}`);
  return j;
}
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const list = JSON.parse(await readFile(file, 'utf8'));
await call('/admin/login', { method: 'POST', json: { email, password } });
const cats = (await call('/admin/categories')).categories;
let ok = 0;
for (const p of list) {
  try {
    let cat = p.category ? cats.find((c) => c.name.toLowerCase() === String(p.category).toLowerCase()) : null;
    if (p.category && !cat) { await call('/admin/categories', { method: 'POST', json: { name: p.category } }); cat = (await call('/admin/categories')).categories.find((c) => c.name.toLowerCase() === p.category.toLowerCase()); cats.push(cat); }
    const r = await call('/admin/products', { method: 'POST', json: { name: p.name, description: p.description || '', category_id: cat?.id || null, featured: !!p.featured, status: p.status || 'active', variations: p.variations } });
    for (const ph of p.photos || []) {
      const path = resolve(dirname(resolve(file)), ph), type = MIME[extname(path).toLowerCase()];
      if (!type) throw new Error(`${ph}: photos must be JPG, PNG or WebP`);
      const fd = new FormData(); fd.append('photo', new Blob([await readFile(path)], { type }), basename(path));
      await call(`/admin/products/${r.id}/images`, { method: 'POST', body: fd });
    }
    ok++; console.log(`✓ ${p.name} (id ${r.id})${r.sync?.skipped ? ' — ' + r.sync.skipped : ''}`);
  } catch (e) { console.error(`✗ ${p.name}: ${e.message}`); }
}
await call('/admin/logout', { method: 'POST' }).catch(() => {});
console.log(`${ok}/${list.length} products added.`);
