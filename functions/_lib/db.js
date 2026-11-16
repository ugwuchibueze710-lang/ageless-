// D1 schema, applied automatically on first request (versioned migrations).
import { nowIso } from './util.js';

const MIGRATIONS = [
  // v1 — full store schema. The old demo `orders` table never held real data.
  `DROP TABLE IF EXISTS orders;
   CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, sort INTEGER NOT NULL DEFAULT 0, visible INTEGER NOT NULL DEFAULT 1, square_id TEXT);
   CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL, featured INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','hidden','deleted')), sort INTEGER NOT NULL DEFAULT 0, is_sample INTEGER NOT NULL DEFAULT 0, price_confirmed INTEGER NOT NULL DEFAULT 1, square_item_id TEXT, square_synced_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS variations (id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE, name TEXT NOT NULL DEFAULT 'Regular', sku TEXT, price_cents INTEGER NOT NULL CHECK (price_cents >= 0), stock INTEGER, sort INTEGER NOT NULL DEFAULT 0, square_variation_id TEXT);
   CREATE INDEX IF NOT EXISTS idx_var_product ON variations(product_id);
   CREATE TABLE IF NOT EXISTS product_images (id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE, url TEXT, data BLOB, mime TEXT, sort INTEGER NOT NULL DEFAULT 0, square_image_id TEXT, created_at TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS idx_img_product ON product_images(product_id);
   CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, access_hash TEXT NOT NULL,
     status TEXT NOT NULL CHECK (status IN ('pending_payment','paid','processing','awaiting_approval','ready_for_pickup','shipped','completed','canceled','refunded','payment_failed','expired')),
     fulfillment TEXT NOT NULL CHECK (fulfillment IN ('pickup','shipping')),
     name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL,
     ship_street TEXT, ship_street2 TEXT, ship_city TEXT, ship_state TEXT, ship_zip TEXT, notes TEXT,
     subtotal_cents INTEGER NOT NULL, shipping_cents INTEGER NOT NULL DEFAULT 0, tax_cents INTEGER NOT NULL DEFAULT 0, total_cents INTEGER NOT NULL, refunded_cents INTEGER NOT NULL DEFAULT 0,
     square_order_id TEXT, square_payment_id TEXT, payment_status TEXT, card_brand TEXT, card_last4 TEXT,
     tracking_carrier TEXT, tracking_number TEXT, hold_expires_at TEXT,
     created_at TEXT NOT NULL, updated_at TEXT NOT NULL, paid_at TEXT);
   CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, created_at);
   CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
   CREATE TABLE IF NOT EXISTS order_items (id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE, product_id INTEGER, variation_id INTEGER,
     name TEXT NOT NULL, variation_name TEXT, sku TEXT, image_url TEXT, unit_cents INTEGER NOT NULL, qty INTEGER NOT NULL CHECK (qty > 0),
     status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','unavailable','awaiting_approval','substituted','refunded','canceled')),
     original_name TEXT, refunded_cents INTEGER NOT NULL DEFAULT 0);
   CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);
   CREATE TABLE IF NOT EXISTS stock_holds (id INTEGER PRIMARY KEY, variation_id INTEGER NOT NULL, order_id INTEGER NOT NULL, qty INTEGER NOT NULL, expires_at TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS idx_holds_var ON stock_holds(variation_id, expires_at);
   CREATE TABLE IF NOT EXISTS substitutions (id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL, order_item_id INTEGER NOT NULL, new_product_id INTEGER NOT NULL, new_variation_id INTEGER NOT NULL, new_name TEXT NOT NULL, new_image_url TEXT, unit_cents INTEGER NOT NULL,
     token_hash TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined','withdrawn')), message TEXT, created_at TEXT NOT NULL, responded_at TEXT);
   CREATE TABLE IF NOT EXISTS order_events (id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, detail TEXT, at TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS idx_events_order ON order_events(order_id);
   CREATE TABLE IF NOT EXISTS webhook_events (event_id TEXT PRIMARY KEY, type TEXT, received_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT);
   CREATE TABLE IF NOT EXISTS staff (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('owner','employee')), pass_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, last_login TEXT);
   CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE, expires_at TEXT NOT NULL, created_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS outbox (id INTEGER PRIMARY KEY, to_email TEXT NOT NULL, subject TEXT NOT NULL, body_html TEXT NOT NULL, order_id INTEGER, status TEXT NOT NULL, error TEXT, created_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS rate_limits (k TEXT PRIMARY KEY, win INTEGER NOT NULL, n INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS app_log (id INTEGER PRIMARY KEY, level TEXT NOT NULL, msg TEXT NOT NULL, detail TEXT, at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS alerts (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, message TEXT NOT NULL, order_id INTEGER, resolved INTEGER NOT NULL DEFAULT 0, at TEXT NOT NULL);`,
  // v2 — per-employee permissions, invite links, activity log
  `ALTER TABLE staff ADD COLUMN perms TEXT NOT NULL DEFAULT '["orders","products","stock"]';
   ALTER TABLE sessions ADD COLUMN last_seen TEXT;
   ALTER TABLE sessions ADD COLUMN ip TEXT;
   CREATE TABLE IF NOT EXISTS invites (id INTEGER PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, name TEXT, email TEXT, role TEXT NOT NULL, perms TEXT NOT NULL, created_by INTEGER, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT, used_by INTEGER, revoked INTEGER NOT NULL DEFAULT 0);
   CREATE TABLE IF NOT EXISTS staff_activity (id INTEGER PRIMARY KEY, staff_id INTEGER, email TEXT, action TEXT NOT NULL, detail TEXT, path TEXT, ip TEXT, at TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS idx_act_staff ON staff_activity(staff_id, id)`,
  // v3 — pay at pickup, sale pricing
  `ALTER TABLE orders ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'card';
   ALTER TABLE orders ADD COLUMN discount_cents INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE order_items ADD COLUMN list_cents INTEGER`,
  // v4 — delivery date the admin promises when an order ships
  `ALTER TABLE orders ADD COLUMN eta_date TEXT;
   ALTER TABLE orders ADD COLUMN eta_note TEXT;
   UPDATE settings SET v = 'Usually arrives in 3–5 business days.' WHERE k = 'shipping_time_text' AND v = 'Ships in 1–2 business days.';
   UPDATE settings SET v = 'Pick up at Ageless inside Eastland Mall, 800 N Green River Rd, Evansville, IN 47715.' WHERE k = 'pickup_instructions' AND v = 'Pick up at Ageless inside Eastland Mall, 800 N Green River Rd, Evansville, IN 47715. We will email you when your order is ready.'`,
  // v5 — Natan's own login (name only, set once from a private link), developer account, first-login guide
  `ALTER TABLE staff ADD COLUMN kind TEXT NOT NULL DEFAULT 'staff';
   ALTER TABLE staff ADD COLUMN guide_done INTEGER NOT NULL DEFAULT 0;
   CREATE TABLE IF NOT EXISTS main_setup (id INTEGER PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, created_by INTEGER, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT);
   INSERT OR IGNORE INTO staff (email, name, role, pass_hash, kind, created_at) VALUES ('admin@agelessevv.com', 'Natan Yona', 'owner', '!', 'main', '2026-11-16T00:00:00.000Z');
   UPDATE staff SET kind = 'main', name = 'Natan Yona', role = 'owner', active = 1 WHERE email = 'admin@agelessevv.com';
   UPDATE staff SET kind = 'developer' WHERE email = 'israelhugo636@gmail.com';
   UPDATE staff SET active = 0 WHERE email = 'ugwuchibueze710@gmail.com';
   DELETE FROM sessions WHERE staff_id IN (SELECT id FROM staff WHERE active = 0)`,
];

// The 11 items already on the site: photos cut from the store's own Google photos.
// is_sample=1 so the admin flags them; price_confirmed=0 where the price was not on a shelf tag.
// Quantity is left unset (NULL): the owner enters real counts in the admin; items with no
// quantity can be viewed but not bought.
const SEED_CATEGORIES = [
  ['Plush', 'plush', 1], ['Ear Hats', 'ear-hats', 2], ['Figures', 'figures', 3], ['Keychains & Charms', 'keychains-charms', 4],
];
const SEED_PRODUCTS = [
  ['ear-hat', 'Light-Up Ear Hat', 'Plush hat with flapping ears that light up', 'ear-hats', 1999, 1, 'ear-hat.jpg'],
  ['lavender-bear', 'Lavender Bear Plush', 'Big, soft & cuddly', 'plush', 2500, 1, 'lavender-bear.jpg'],
  ['blue-plush', 'Blue Alien Plush', 'Fan-favorite blue buddy', 'plush', 2000, 1, 'blue-plush.jpg'],
  ['yellow-duck', 'Yellow Duck Plush', 'Soft, squishy, adorable', 'plush', 1999, 1, 'yellow-duck.jpg'],
  ['mini-plush', 'Mini Plush', 'From the $15 plush bins', 'plush', 1500, 1, 'mini-plush.jpg'],
  ['rainbow-plush', 'Rainbow Alien Plush', 'Tie-dye rainbow colors', 'plush', 2000, 0, 'rainbow-plush.jpg'],
  ['spooky-bunny', 'Spooky Bunny Plush', 'Pastel goth cuteness', 'plush', 2500, 0, 'spooky-bunny.jpg'],
  ['figures', 'Boxed Anime Figure', 'Collector figures — ask for characters in stock', 'figures', 4999, 0, 'figures.jpg'],
  ['keychains', 'Anime Keychain', 'Rubber keychains — dozens of characters', 'keychains-charms', 1000, 0, 'keychains.jpg'],
  ['shoe-charms', 'Shoe Charm', 'Pick from hundreds in the charm bins', 'keychains-charms', 300, 0, 'shoe-charms.jpg'],
  ['paw-squishy', 'Cat Paw Squishy', 'Squishy paw stress toy', 'keychains-charms', 999, 0, 'paw-squishy.jpg'],
];
const DEFAULT_SETTINGS = {
  shipping_enabled: '1', pickup_enabled: '1',
  shipping_mode: 'flat', shipping_flat_cents: '', shipping_free_over_cents: '', shipping_tiers: '[]',
  shipping_note: 'Ships within the United States only.',
  pickup_instructions: 'Pick up at Ageless inside Eastland Mall, 800 N Green River Rd, Evansville, IN 47715.',
  store_name: 'Ageless', store_email: '', store_phone: '(317) 599-2537',
  hold_minutes: '10',
  pay_in_store_enabled: '1',
  pickup_ready_text: 'Usually ready within 2 hours during store hours.',
  shipping_time_text: 'Usually arrives in 3–5 business days.', delivery_days: '4',
  pickup_hold_days: '3',
  site_announcement: '',
  marquee_items: JSON.stringify(['Plush', 'Light-Up Ear Hats', 'Anime Figures', 'Keychains', 'Shoe Charms', 'Wall Scrolls', 'Squishies']),
  store_address: 'Inside Eastland Mall\n800 N Green River Rd\nEvansville, IN 47715',
  store_hours: JSON.stringify([['Monday – Thursday', '10 AM – 8 PM'], ['Friday – Saturday', '10 AM – 9 PM'], ['Sunday', '12 PM – 6 PM']]),
  sale_enabled: '0', sale_percent: '', sale_category_id: '', sale_label: '', sale_ends: '',
};

// Active sale percent for a product's category (0 when no sale).
export function salePercent(s, categoryId) {
  if (s.sale_enabled !== '1') return 0;
  const pct = Math.trunc(Number(s.sale_percent));
  if (!(pct >= 1 && pct <= 90)) return 0;
  if (s.sale_ends && Date.now() > Date.parse(s.sale_ends + 'T23:59:59-05:00')) return 0;
  if (s.sale_category_id && String(s.sale_category_id) !== String(categoryId)) return 0;
  return pct;
}
export const salePrice = (cents, pct) => (pct ? Math.round(cents * (100 - pct) / 100) : cents);

let ready = null;
export function ensureSchema(env) {
  if (!ready) ready = migrate(env).catch((e) => { ready = null; throw e; });
  return ready;
}

async function migrate(env) {
  const db = env.DB;
  await db.prepare('CREATE TABLE IF NOT EXISTS schema_version (v INTEGER NOT NULL)').run();
  const row = await db.prepare('SELECT MAX(v) AS v FROM schema_version').first();
  let v = row?.v || 0;
  for (let i = v; i < MIGRATIONS.length; i++) {
    const stmts = MIGRATIONS[i].split(';').map((s) => s.trim()).filter(Boolean).map((s) => db.prepare(s));
    stmts.push(db.prepare('INSERT INTO schema_version (v) VALUES (?)').bind(i + 1));
    await db.batch(stmts);
    if (i === 0) await seed(db);
    v = i + 1;
  }
  // settings defaults (insert missing keys only)
  await db.batch(Object.entries(DEFAULT_SETTINGS).map(([k, val]) =>
    db.prepare('INSERT OR IGNORE INTO settings (k, v) VALUES (?, ?)').bind(k, val)));
}

async function seed(db) {
  const now = nowIso();
  await db.batch(SEED_CATEGORIES.map(([n, s, o]) => db.prepare('INSERT OR IGNORE INTO categories (name, slug, sort) VALUES (?, ?, ?)').bind(n, s, o)));
  const cats = Object.fromEntries((await db.prepare('SELECT id, slug FROM categories').all()).results.map((r) => [r.slug, r.id]));
  let sort = 0;
  for (const [slug, name, desc, cat, cents, confirmed, img] of SEED_PRODUCTS) {
    sort++;
    const p = await db.prepare(`INSERT OR IGNORE INTO products (slug, name, description, category_id, status, sort, is_sample, price_confirmed, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'active', ?, 1, ?, ?, ?) RETURNING id`).bind(slug, name, desc, cats[cat] || null, sort, confirmed, now, now).first();
    if (!p) continue;
    await db.batch([
      db.prepare('INSERT INTO variations (product_id, name, price_cents, stock, sort) VALUES (?, ?, ?, NULL, 0)').bind(p.id, 'Regular', cents),
      db.prepare('INSERT INTO product_images (product_id, url, sort, created_at) VALUES (?, ?, 0, ?)').bind(p.id, '/assets/img/toys/' + img, now),
    ]);
  }
}

export async function getSettings(env) {
  const rows = (await env.DB.prepare('SELECT k, v FROM settings').all()).results;
  return Object.fromEntries(rows.map((r) => [r.k, r.v]));
}
export async function setSetting(env, k, v) {
  await env.DB.prepare('INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').bind(k, v == null ? null : String(v)).run();
}
