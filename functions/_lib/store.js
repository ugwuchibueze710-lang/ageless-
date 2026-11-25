// Catalog reads, stock availability, holds (oversell protection) and order state changes.
import { nowIso, log, fail } from './util.js';
import { notify } from './email.js';
import { getSettings, salePercent, salePrice } from './db.js';

export const imgUrl = (r) => r.url || `/api/img/${r.id}`;

export async function cleanupExpired(env) {
  const now = nowIso();
  const exp = (await env.DB.prepare("SELECT id FROM orders WHERE status = 'pending_payment' AND hold_expires_at < ?").bind(now).all()).results;
  const stmts = [env.DB.prepare('DELETE FROM stock_holds WHERE expires_at < ?').bind(now)];
  for (const o of exp) {
    stmts.push(env.DB.prepare("UPDATE orders SET status = 'expired', updated_at = ? WHERE id = ? AND status = 'pending_payment'").bind(now, o.id));
    stmts.push(env.DB.prepare("INSERT INTO order_events (order_id, actor, action, detail, at) VALUES (?, 'system', 'expired', 'Checkout not completed in time; items released', ?)").bind(o.id, now));
  }
  await env.DB.batch(stmts);
}

// stock minus active holds; null when the owner has not set a quantity yet
export async function availability(env, variationIds, exceptOrderId = 0) {
  if (!variationIds.length) return {};
  const q = variationIds.map(() => '?').join(',');
  const rows = (await env.DB.prepare(`SELECT v.id, v.stock, COALESCE((SELECT SUM(h.qty) FROM stock_holds h WHERE h.variation_id = v.id AND h.expires_at > ? AND h.order_id != ?), 0) AS held
    FROM variations v WHERE v.id IN (${q})`).bind(nowIso(), exceptOrderId, ...variationIds).all()).results;
  return Object.fromEntries(rows.map((r) => [r.id, r.stock == null ? null : Math.max(0, r.stock - r.held)]));
}

// Best sellers: units sold from real orders (paid and not canceled/refunded/expired), last 30 days first,
// topped up with all-time sales so the list fills as soon as possible. Only products still on sale count.
const SOLD = "('paid','processing','awaiting_approval','ready_for_pickup','shipped','completed')";
export async function topSellers(env, limit = 5) {
  const q = (since) => env.DB.prepare(`SELECT i.product_id AS id, SUM(i.qty) AS units, SUM(i.qty * i.unit_cents) AS cents
    FROM order_items i JOIN orders o ON o.id = i.order_id JOIN products p ON p.id = i.product_id
    WHERE o.status IN ${SOLD} AND o.paid_at IS NOT NULL AND i.status IN ('ok','substituted') AND p.status = 'active' ${since ? 'AND o.paid_at >= ?' : ''}
    GROUP BY i.product_id ORDER BY units DESC, cents DESC, MAX(o.paid_at) DESC LIMIT ?`).bind(...(since ? [since, limit] : [limit])).all();
  const recent = (await q(new Date(Date.now() - 30 * 864e5).toISOString())).results;
  if (recent.length >= limit) return recent.map((r) => ({ ...r, recent: true }));
  const have = new Set(recent.map((r) => r.id));
  const rest = (await q(null)).results.filter((r) => !have.has(r.id));
  return recent.map((r) => ({ ...r, recent: true })).concat(rest).slice(0, limit);
}

export async function publicCatalog(env, slug) {
  const db = env.DB;
  const cats = (await db.prepare('SELECT id, name, slug FROM categories WHERE visible = 1 ORDER BY sort, name').all()).results;
  const prods = (await db.prepare(`SELECT p.id, p.slug, p.name, p.description, p.featured, p.category_id, p.sort, p.updated_at FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.status = 'active' AND (c.id IS NULL OR c.visible = 1) ${slug ? 'AND p.slug = ?' : ''} ORDER BY p.featured DESC, p.sort, p.id`).bind(...(slug ? [slug] : [])).all()).results;
  if (!prods.length) return { categories: cats, products: [] };
  const ids = prods.map((p) => p.id), q = ids.map(() => '?').join(',');
  const vars = (await db.prepare(`SELECT id, product_id, name, sku, price_cents, stock FROM variations WHERE product_id IN (${q}) ORDER BY sort, id`).bind(...ids).all()).results;
  const imgs = (await db.prepare(`SELECT id, product_id, url FROM product_images WHERE product_id IN (${q}) ORDER BY sort, id`).bind(...ids).all()).results;
  const avail = await availability(env, vars.map((v) => v.id));
  const S = await getSettings(env);
  const catById = Object.fromEntries(cats.map((c) => [c.id, c]));
  const out = {
    categories: cats,
    products: prods.map((p) => {
      const pct = salePercent(S, p.category_id);
      const pv = vars.filter((v) => v.product_id === p.id).map((v) => ({ id: v.id, name: v.name, sku: v.sku, price_cents: salePrice(v.price_cents, pct), list_cents: pct ? v.price_cents : null,
        available: avail[v.id], purchasable: avail[v.id] != null && avail[v.id] > 0 }));
      return { id: p.id, slug: p.slug, name: p.name, description: p.description, featured: !!p.featured, sale_percent: pct || null,
        category: catById[p.category_id]?.slug || null, category_name: catById[p.category_id]?.name || null,
        images: imgs.filter((i) => i.product_id === p.id).map((i) => imgUrl(i) + (i.url ? '' : '?v=' + encodeURIComponent(p.updated_at))),
        variations: pv, min_price_cents: pv.length ? Math.min(...pv.map((v) => v.price_cents)) : 0,
        in_stock: pv.some((v) => v.purchasable), quantity_set: pv.every((v) => v.available != null) };
    }).filter((p) => p.variations.length),
  };
  // Best Sellers row: ids only, ranked #1..#5, and only things a shopper can actually add to the cart right now.
  const buyable = new Set(out.products.filter((p) => p.in_stock).map((p) => p.id));
  out.bestsellers = !slug && S.bestsellers_enabled !== '0' ? (await topSellers(env, 12)).map((r) => r.id).filter((id) => buyable.has(id)).slice(0, 5) : [];
  return out;
}

// Atomically reserve stock for an order. Returns list of variation ids that could not be held.
export async function placeHolds(env, orderId, lines, minutes) {
  const now = nowIso(), exp = new Date(Date.now() + minutes * 60e3).toISOString();
  const stmts = lines.map((l) => env.DB.prepare(`INSERT INTO stock_holds (variation_id, order_id, qty, expires_at)
    SELECT ?1, ?2, ?3, ?4 WHERE (SELECT stock FROM variations WHERE id = ?1) IS NOT NULL AND
      (SELECT stock FROM variations WHERE id = ?1) - COALESCE((SELECT SUM(qty) FROM stock_holds WHERE variation_id = ?1 AND expires_at > ?5), 0) >= ?3`)
    .bind(l.variation_id, orderId, l.qty, exp, now));
  const res = await env.DB.batch(stmts);
  const failed = lines.filter((l, i) => !res[i].meta.changes).map((l) => l.variation_id);
  if (failed.length) await env.DB.prepare('DELETE FROM stock_holds WHERE order_id = ?').bind(orderId).run();
  return { failed, expiresAt: exp };
}

export async function event(env, orderId, actor, action, detail) {
  await env.DB.prepare('INSERT INTO order_events (order_id, actor, action, detail, at) VALUES (?, ?, ?, ?, ?)').bind(orderId, actor, action, detail || null, nowIso()).run();
}

export async function loadOrder(env, where, val) {
  const o = await env.DB.prepare(`SELECT * FROM orders WHERE ${where} = ?`).bind(val).first();
  if (!o) return null;
  o.items = (await env.DB.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').bind(o.id).all()).results;
  return o;
}

// Payment confirmed by Square: decrement stock, release holds, mark paid, notify. Idempotent.
export async function markPaid(env, o, payment, actor = 'system') {
  const now = nowIso();
  const upd = await env.DB.prepare(`UPDATE orders SET status = 'paid', payment_status = ?, square_payment_id = ?, card_brand = ?, card_last4 = ?, paid_at = ?, updated_at = ?
    WHERE id = ? AND status IN ('pending_payment','payment_failed','expired')`)
    .bind(payment.status, payment.id, payment.card_details?.card?.card_brand || null, payment.card_details?.card?.last_4 || null, now, now, o.id).run();
  if (!upd.meta.changes) return false; // already processed
  const stmts = [env.DB.prepare('DELETE FROM stock_holds WHERE order_id = ?').bind(o.id)];
  for (const it of o.items) if (it.variation_id) stmts.push(env.DB.prepare('UPDATE variations SET stock = CASE WHEN stock IS NULL THEN NULL ELSE stock - ? END WHERE id = ?').bind(it.qty, it.variation_id));
  stmts.push(env.DB.prepare('INSERT INTO order_events (order_id, actor, action, detail, at) VALUES (?, ?, ?, ?, ?)').bind(o.id, actor, 'paid', `Square payment ${payment.id} ${payment.status}`, now));
  await env.DB.batch(stmts);
  const neg = (await env.DB.prepare(`SELECT v.id, p.name FROM order_items oi JOIN variations v ON v.id = oi.variation_id JOIN products p ON p.id = v.product_id WHERE oi.order_id = ? AND v.stock < 0`).bind(o.id).all()).results;
  for (const n of neg) await raiseAlert(env, 'oversold', `${n.name} is oversold after order ${o.code}. Offer the customer a same-price substitute or refund the item.`, o.id);
  return true;
}

export async function raiseAlert(env, kind, message, orderId) {
  await env.DB.prepare('INSERT INTO alerts (kind, message, order_id, at) VALUES (?, ?, ?, ?)').bind(kind, message, orderId || null, nowIso()).run();
  await notify(env, 'store_alert', orderId ? await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first() : null, [], { subject: kind, message });
}

export function orderLink(siteUrl, code, accessToken) { return `${siteUrl}/order.html?c=${encodeURIComponent(code)}${accessToken ? '&t=' + encodeURIComponent(accessToken) : ''}`; }

export function assertTransition(from, to) {
  const ok = {
    paid: ['processing', 'ready_for_pickup', 'shipped', 'completed', 'canceled'],
    processing: ['ready_for_pickup', 'shipped', 'completed', 'canceled'],
    awaiting_approval: ['processing', 'ready_for_pickup', 'shipped', 'canceled'],
    ready_for_pickup: ['completed', 'processing', 'canceled'],
    shipped: ['completed'],
    completed: [],
  };
  if (!(ok[from] || []).includes(to)) fail(400, `Cannot change an order from "${from}" to "${to}".`);
}
