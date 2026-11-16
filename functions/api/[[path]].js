// Ageless API router (Cloudflare Pages Function, handles every /api/* request).
import { json, fail, HttpError, readJson, str, text, int, isEmail, isPhone, isZip, US_STATES, slugify, dollarsToCents, clientIp,
  code as makeCode, token as makeToken, sha256Hex, timingSafeEqual, nowIso, money, limitOr429, log, siteUrl } from '../_lib/util.js';
import { ensureSchema, getSettings, setSetting, salePercent, salePrice } from '../_lib/db.js';
import { hashPassword, verifyPassword, passwordProblem, createSession, clearCookie, destroySession, requireStaff, PERMS, permsOf, cleanPerms, OWNER_ONLY_PERMS } from '../_lib/auth.js';
import { aiChat, aiReview, ruleCheck, aiConfigured, allowedPath, riskOf } from '../_lib/ai.js';
import * as sq from '../_lib/square.js';
import { notify } from '../_lib/email.js';
import { cleanupExpired, availability, publicCatalog, placeHolds, event, loadOrder, markPaid, raiseAlert, orderLink, assertTransition, imgUrl } from '../_lib/store.js';

const routes = [];
const on = (method, pattern, fn) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), fn });

export async function onRequest(ctx) {
  const { request, env } = ctx;
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api/, '') || '/';
  try {
    if (!env.DB) fail(500, 'Database binding DB is missing.');
    await ensureSchema(env);
    for (const r of routes) {
      if (r.method !== request.method) continue;
      const m = path.match(r.re);
      if (m) {
        const res = await r.fn({ ...ctx, url, params: m.groups || {} });
        const st = request.__staff;
        if (st && res.status < 400 && (request.method !== 'GET' || /^\/admin\/orders\/\d+$/.test(path))) {
          const what = describe(request.method, path);
          if (what) await activity(env, st, what + (request.headers.get('X-Ageless-Via') === 'assistant' ? ' (via AI assistant)' : ''), null, request, path);
        }
        return res;
      }
    }
    return json({ error: 'Not found' }, 404);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message, ...(e.extra || {}) }, e.status);
    await log(env, 'error', 'Unhandled API error', { path, method: request.method, error: String(e && e.stack || e) });
    return json({ error: e.status && e.message ? e.message : 'Something went wrong. Please try again.' }, e.status && e.status >= 400 && e.status < 600 ? (e.status === 401 ? 502 : e.status) : 500);
  }
}


// ---------- staff activity ----------
async function activity(env, st, action, detail, request, path) {
  try {
    await env.DB.prepare('INSERT INTO staff_activity (staff_id, email, action, detail, path, ip, at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(st?.id || null, st?.email || null, action, detail || null, path || null, request ? clientIp(request) : null, nowIso()).run();
  } catch { /* never block the request */ }
}
const DESCRIBE = [
  ['GET', /^\/admin\/orders\/(\d+)$/, (m) => `Viewed order #${m[1]}`],
  ['POST', /^\/admin\/orders\/(\d+)\/status$/, (m) => `Changed status of order #${m[1]}`],
  ['POST', /^\/admin\/orders\/(\d+)\/eta$/, (m) => `Changed the delivery date of order #${m[1]}`],
  ['POST', /^\/admin\/orders\/(\d+)\/note$/, (m) => `Added a note to order #${m[1]}`],
  ['POST', /^\/admin\/orders\/(\d+)\/refund$/, (m) => `Refunded order #${m[1]}`],
  ['POST', /^\/admin\/orders\/(\d+)\/items\/\d+\/unavailable$/, (m) => `Marked an item unavailable in order #${m[1]}`],
  ['POST', /^\/admin\/orders\/(\d+)\/items\/\d+\/substitute$/, (m) => `Offered a substitute in order #${m[1]}`],
  ['POST', /^\/admin\/orders\/(\d+)\/resend$/, (m) => `Resent an email for order #${m[1]}`],
  ['POST', /^\/admin\/substitutions\/\d+\/withdraw$/, () => 'Withdrew a substitute offer'],
  ['POST', /^\/admin\/products$/, () => 'Added a product'],
  ['PUT', /^\/admin\/products\/(\d+)$/, (m) => `Edited product #${m[1]}`],
  ['DELETE', /^\/admin\/products\/(\d+)$/, (m) => `Deleted product #${m[1]}`],
  ['POST', /^\/admin\/products\/(\d+)\/images$/, (m) => `Added photos to product #${m[1]}`],
  ['POST', /^\/admin\/products\/(\d+)\/images\/order$/, (m) => `Reordered photos of product #${m[1]}`],
  ['DELETE', /^\/admin\/images\/\d+$/, () => 'Deleted a product photo'],
  ['POST', /^\/admin\/products\/(\d+)\/sync$/, (m) => `Synced product #${m[1]} to Square`],
  ['POST', /^\/admin\/stock$/, () => 'Changed quantities'],
  ['POST', /^\/admin\/categories$/, () => 'Added a category'],
  ['PUT', /^\/admin\/categories\/\d+$/, () => 'Edited a category'],
  ['DELETE', /^\/admin\/categories\/\d+$/, () => 'Deleted a category'],
  ['PUT', /^\/admin\/settings$/, () => 'Changed store settings'],
  ['POST', /^\/admin\/square\/disconnect$/, () => 'Disconnected Square'],
  ['POST', /^\/admin\/square\/location$/, () => 'Changed the Square location'],
  ['POST', /^\/admin\/square\/push$/, () => 'Sent products to Square'],
  ['POST', /^\/admin\/square\/pull-stock$/, () => 'Pulled stock from Square'],
  ['POST', /^\/admin\/square\/import$/, () => 'Imported items from Square'],
  ['POST', /^\/admin\/staff$/, () => 'Added a staff member'],
  ['PUT', /^\/admin\/staff\/(\d+)$/, (m) => `Changed staff member #${m[1]}`],
  ['POST', /^\/admin\/invites$/, () => 'Created an invite link'],
  ['DELETE', /^\/admin\/invites\/\d+$/, () => 'Canceled an invite link'],
  ['POST', /^\/admin\/password$/, () => 'Changed own password'],
  ['POST', /^\/admin\/alerts\/\d+\/resolve$/, () => 'Cleared an alert'],
  ['POST', /^\/admin\/orders\/(\d+)\/paid-in-store$/, (m) => `Marked order #${m[1]} paid at the store`],
  ['POST', /^\/admin\/orders\/(\d+)\/cancel-unpaid$/, (m) => `Canceled unpaid pickup order #${m[1]}`],
  ['POST', /^\/admin\/orders\/(\d+)\/items\/\d+\/remove$/, (m) => `Removed an item from order #${m[1]}`],
  ['POST', /^\/admin\/ai\/chat$/, () => 'Asked the AI assistant'],
];
function describe(method, path) {
  for (const [m, re, fn] of DESCRIBE) { if (m !== method) continue; const x = path.match(re); if (x) return fn(x); }
  return null;
}

// ======================================================================
// PUBLIC
// ======================================================================
on('GET', '/config', async ({ env }) => {
  const s = await getSettings(env);
  const connected = await sq.isConnected(env);
  return json({
    paymentsEnabled: connected,
    square: connected ? { appId: env.SQUARE_APP_ID, locationId: s.sq_location_id, env: sq.squareEnv(env) } : null,
    shipping: { enabled: shippingOn(s, connected), note: s.shipping_note, time: s.shipping_time_text, freeOverCents: s.shipping_free_over_cents ? Number(s.shipping_free_over_cents) : null },
    pickup: { enabled: s.pickup_enabled === '1', instructions: s.pickup_instructions, ready: s.pickup_ready_text, holdDays: Number(s.pickup_hold_days) || 3 },
    payInStore: payInStoreOn(s, connected),
    store: { phone: s.store_phone || null, address: s.store_address || '', hours: safeJson(s.store_hours, []) },
    site: { announcement: s.site_announcement || '', marquee: safeJson(s.marquee_items, []) },
    sale: saleInfo(s),
  });
});

on('GET', '/products', async ({ env }) => {
  await cleanupExpired(env);
  return json(await publicCatalog(env));
});
on('GET', '/products/:slug', async ({ env, params }) => {
  const c = await publicCatalog(env, decodeURIComponent(params.slug));
  if (!c.products.length) fail(404, 'Product not found');
  return json({ product: c.products[0] });
});

on('GET', '/img/:id', async ({ env, params }) => {
  const r = await env.DB.prepare('SELECT data, mime FROM product_images WHERE id = ? AND data IS NOT NULL').bind(int(params.id) || 0).first();
  if (!r) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(r.data), { headers: { 'Content-Type': r.mime || 'image/jpeg', 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' } });
});

// ---------- shipping / payment options ----------
function safeJson(v, d) { try { const x = JSON.parse(v || ''); return x ?? d; } catch { return d; } }
// Shipping needs online payment, so it only appears once Square is connected.
function shippingOn(s, connected) { return connected && s.shipping_enabled === '1' && shippingConfigured(s); }
// Without Square, pay-at-pickup is the only way to order, so it is always on then.
function payInStoreOn(s, connected) { return s.pickup_enabled === '1' && (!connected || s.pay_in_store_enabled === '1'); }
function saleInfo(s) {
  const pct = salePercent(s, s.sale_category_id || null);
  return pct ? { percent: pct, label: s.sale_label || `${pct}% off`, categoryId: s.sale_category_id ? Number(s.sale_category_id) : null, ends: s.sale_ends || null } : null;
}
function shippingConfigured(s) {
  if (s.shipping_mode === 'tiers') { try { return JSON.parse(s.shipping_tiers || '[]').length > 0; } catch { return false; } }
  return s.shipping_flat_cents !== '' && s.shipping_flat_cents != null;
}
function shippingFor(s, subtotal) {
  if (s.shipping_free_over_cents && subtotal >= Number(s.shipping_free_over_cents)) return 0;
  if (s.shipping_mode === 'tiers') {
    const tiers = JSON.parse(s.shipping_tiers || '[]').sort((a, b) => b.min_cents - a.min_cents);
    const t = tiers.find((x) => subtotal >= x.min_cents); return t ? t.rate_cents : tiers.at(-1)?.rate_cents ?? 0;
  }
  return Number(s.shipping_flat_cents || 0);
}

// ---------- checkout ----------
async function cartLines(env, items, S) {
  S = S || await getSettings(env);
  if (!Array.isArray(items) || !items.length) fail(400, 'Your cart is empty.');
  if (items.length > 50) fail(400, 'Too many items.');
  const want = {};
  for (const it of items) { const id = int(it.variation_id, 1), q = int(it.qty, 1, 99); if (!id || !q) fail(400, 'Invalid cart item.'); want[id] = (want[id] || 0) + q; }
  const ids = Object.keys(want).map(Number), qm = ids.map(() => '?').join(',');
  const rows = (await env.DB.prepare(`SELECT v.id AS variation_id, v.name AS variation_name, v.sku, v.price_cents, v.stock, v.square_variation_id, p.id AS product_id, p.name, p.status, p.category_id,
      (SELECT COALESCE(url, '/api/img/' || id) FROM product_images i WHERE i.product_id = p.id ORDER BY sort, id LIMIT 1) AS image_url
    FROM variations v JOIN products p ON p.id = v.product_id WHERE v.id IN (${qm})`).bind(...ids).all()).results;
  const byId = Object.fromEntries(rows.map((r) => [r.variation_id, r]));
  const avail = await availability(env, ids);
  const lines = [], problems = [];
  for (const id of ids) {
    const r = byId[id];
    if (!r || r.status !== 'active') { problems.push({ variation_id: id, reason: 'This item is no longer sold.' }); continue; }
    const a = avail[id];
    if (a == null) problems.push({ variation_id: id, name: r.name, reason: 'Not available online yet — the store has not set a quantity.' });
    else if (a < want[id]) problems.push({ variation_id: id, name: r.name, available: a, reason: a === 0 ? 'Out of stock.' : `Only ${a} left.` });
    const pct = salePercent(S, r.category_id);
    lines.push({ ...r, qty: want[id], unit_cents: salePrice(r.price_cents, pct), list_cents: pct ? r.price_cents : null });
  }
  return { lines, problems, subtotal: lines.reduce((t, l) => t + l.unit_cents * l.qty, 0) };
}
function readCustomer(b) {
  const c = b.customer || {};
  const o = { name: str(c.name, 80), email: str(c.email, 120).toLowerCase(), phone: str(c.phone, 30), notes: text(b.notes, 500),
    fulfillment: b.fulfillment === 'shipping' ? 'shipping' : 'pickup' };
  if (o.name.length < 2) fail(400, 'Please enter your full name.');
  if (!isEmail(o.email)) fail(400, 'Please enter a valid email.');
  if (!isPhone(o.phone)) fail(400, 'Please enter a valid phone number.');
  if (o.fulfillment === 'shipping') {
    const a = b.address || {};
    Object.assign(o, { ship_street: str(a.street, 120), ship_street2: str(a.street2, 120), ship_city: str(a.city, 60), ship_state: str(a.state, 2).toUpperCase(), ship_zip: str(a.zip, 10) });
    if (o.ship_street.length < 4 || o.ship_city.length < 2) fail(400, 'Please enter your full shipping address.');
    if (!US_STATES.includes(o.ship_state)) fail(400, 'We ship within the United States only. Please pick a US state.');
    if (!isZip(o.ship_zip)) fail(400, 'Please enter a valid US ZIP code.');
  }
  return o;
}

on('POST', '/checkout/quote', async ({ env, request }) => {
  await limitOr429(env, request, 'quote', 60, 60);
  await cleanupExpired(env);
  const b = await readJson(request);
  const s = await getSettings(env);
  const { lines, problems, subtotal } = await cartLines(env, b.items, s);
  const fulfillment = b.fulfillment === 'shipping' ? 'shipping' : 'pickup';
  const connected = await sq.isConnected(env);
  if (fulfillment === 'shipping' && !shippingOn(s, connected)) problems.push({ reason: 'Shipping is not available yet — please choose in-store pickup.' });
  if (fulfillment === 'pickup' && s.pickup_enabled !== '1') problems.push({ reason: 'In-store pickup is not available right now.' });
  const shipping = fulfillment === 'shipping' && shippingConfigured(s) ? shippingFor(s, subtotal) : 0;
  const saved = lines.reduce((t, l) => t + (l.list_cents ? (l.list_cents - l.unit_cents) * l.qty : 0), 0);
  return json({ subtotal_cents: subtotal, saved_cents: saved, shipping_cents: shipping, tax_note: 'Sales tax, if any, is calculated by Square at payment.', problems,
    lines: lines.map((l) => ({ variation_id: l.variation_id, name: l.name, qty: l.qty, unit_cents: l.unit_cents })) });
});

on('POST', '/checkout/start', async ({ env, request }) => {
  await limitOr429(env, request, 'checkout', 15, 600);
  if (!(await sq.isConnected(env))) fail(409, 'Online checkout is coming soon. To buy now, visit Ageless inside Eastland Mall.');
  await cleanupExpired(env);
  const b = await readJson(request);
  const s = await getSettings(env);
  const cust = readCustomer(b);
  if (cust.fulfillment === 'shipping' && !shippingOn(s, true)) fail(400, 'Shipping is not available yet — please choose in-store pickup.');
  if (cust.fulfillment === 'pickup' && s.pickup_enabled !== '1') fail(400, 'In-store pickup is not available right now.');
  const { lines, problems, subtotal } = await cartLines(env, b.items, s);
  if (problems.length) fail(409, problems[0].reason, { problems });
  const shipping = cust.fulfillment === 'shipping' ? shippingFor(s, subtotal) : 0;
  const { o, access } = await createOrderRow(env, cust, lines, subtotal, shipping, 'pending_payment', 'card');
  await insertItems(env, o.id, lines);
  const minutes = int(s.hold_minutes, 5, 30) || 10;
  const held = await placeHolds(env, o.id, lines, minutes);
  if (held.failed.length) {
    await env.DB.prepare("UPDATE orders SET status = 'expired', updated_at = ? WHERE id = ?").bind(nowIso(), o.id).run();
    const names = lines.filter((l) => held.failed.includes(l.variation_id)).map((l) => l.name);
    fail(409, `Sorry — ${names.join(', ')} just sold out. Please update your cart.`, { problems: held.failed.map((id) => ({ variation_id: id, reason: 'Just sold out.' })) });
  }
  // tax from Square
  let tax = 0;
  try { const calc = await sq.calculate(env, o, lines, shipping); tax = calc.tax; }
  catch (e) { await log(env, 'warn', 'Square calculate failed; continuing without tax preview', { e: String(e) }); }
  await env.DB.prepare('UPDATE orders SET tax_cents = ?, total_cents = ?, hold_expires_at = ? WHERE id = ?').bind(tax, subtotal + shipping + tax, held.expiresAt, o.id).run();
  await event(env, o.id, 'customer', 'created', `Checkout started; items held until ${held.expiresAt}`);
  return json({ code: o.code, token: access, subtotal_cents: subtotal, shipping_cents: shipping, tax_cents: tax, total_cents: subtotal + shipping + tax, hold_expires_at: held.expiresAt });
});

async function createOrderRow(env, cust, lines, subtotal, shipping, status, method) {
  const access = makeToken(24), now = nowIso();
  const discount = lines.reduce((t, l) => t + (l.list_cents ? (l.list_cents - l.unit_cents) * l.qty : 0), 0);
  let o;
  for (let tries = 0; tries < 5 && !o; tries++) {
    try {
      o = await env.DB.prepare(`INSERT INTO orders (code, access_hash, status, fulfillment, name, email, phone, ship_street, ship_street2, ship_city, ship_state, ship_zip, notes,
        subtotal_cents, shipping_cents, tax_cents, total_cents, created_at, updated_at, payment_method, discount_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?) RETURNING *`)
        .bind('AG-' + makeCode(6), await sha256Hex(access), status, cust.fulfillment, cust.name, cust.email, cust.phone, cust.ship_street || null, cust.ship_street2 || null,
          cust.ship_city || null, cust.ship_state || null, cust.ship_zip || null, cust.notes || null, subtotal, shipping, subtotal + shipping, now, now, method, discount).first();
    } catch (e) { if (!String(e).includes('UNIQUE')) throw e; }
  }
  if (!o) fail(500, 'Could not create the order. Please try again.');
  await insertItems(env, o.id, lines);
  return { o, access };
}
async function insertItems(env, orderId, lines) {
  await env.DB.batch(lines.map((l) => env.DB.prepare(`INSERT INTO order_items (order_id, product_id, variation_id, name, variation_name, sku, image_url, unit_cents, qty, list_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(orderId, l.product_id, l.variation_id, l.name, l.variation_name, l.sku, l.image_url, l.unit_cents, l.qty, l.list_cents || null)));
}

// Pay at pickup: no card. Items come off the shelf count right away (atomic, no overselling);
// the buyer pays at the counter. Staff mark it paid, or cancel a no-show (stock goes back).
on('POST', '/checkout/reserve', async ({ env, request }) => {
  await limitOr429(env, request, 'reserve', 8, 600);
  await cleanupExpired(env);
  const b = await readJson(request);
  const s = await getSettings(env);
  const connected = await sq.isConnected(env);
  const cust = readCustomer({ ...b, fulfillment: 'pickup' });
  if (!payInStoreOn(s, connected)) fail(400, 'Paying at pickup is not available right now. Please pay online.');
  const { lines, problems, subtotal } = await cartLines(env, b.items, s);
  if (problems.length) fail(409, problems[0].reason, { problems });
  const { o, access } = await createOrderRow(env, cust, lines, subtotal, 0, 'pending_payment', 'store');
  const held = await placeHolds(env, o.id, lines, 5);
  if (held.failed.length) {
    await env.DB.prepare("UPDATE orders SET status = 'expired', updated_at = ? WHERE id = ?").bind(nowIso(), o.id).run();
    const names = lines.filter((l) => held.failed.includes(l.variation_id)).map((l) => l.name);
    fail(409, `Sorry — ${names.join(', ')} just sold out. Please update your cart.`, { problems: held.failed.map((id) => ({ variation_id: id, reason: 'Just sold out.' })) });
  }
  const now = nowIso();
  await env.DB.batch([
    ...lines.map((l) => env.DB.prepare('UPDATE variations SET stock = CASE WHEN stock IS NULL THEN NULL ELSE stock - ? END WHERE id = ?').bind(l.qty, l.variation_id)),
    env.DB.prepare('DELETE FROM stock_holds WHERE order_id = ?').bind(o.id),
    env.DB.prepare("UPDATE orders SET status = 'processing', payment_status = 'PAY_AT_PICKUP', updated_at = ? WHERE id = ?").bind(now, o.id),
    env.DB.prepare("INSERT INTO order_events (order_id, actor, action, detail, at) VALUES (?, 'customer', 'reserved', 'Pickup order placed — customer pays at the store', ?)").bind(o.id, now),
  ]);
  const fresh = await loadOrder(env, 'id', o.id), site = siteUrl(request, env);
  await notify(env, 'store_new_order', fresh, fresh.items, { link: `${site}/admin/#/orders/${o.id}`, linkText: 'Open in admin' });
  await notify(env, 'customer_confirmation', fresh, fresh.items, { link: await customerLink(env, site, o.code), linkText: 'View your order' });
  return json({ code: o.code, token: access, status: 'reserved' });
});

// Email links use a key derived from the order code and the server secret, so any later email can link to the order page.
async function linkToken(env, code) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode('order-link:' + (env.TOKEN_KEY || '')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(code)));
  return btoa(String.fromCharCode(...sig)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').slice(0, 32);
}
// Delivery day the store promises: YYYY-MM-DD, from yesterday (time zones) up to 90 days out.
function etaDate(v) {
  const d = String(v || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || isNaN(Date.parse(d + 'T12:00:00Z'))) fail(400, 'Pick the day the customer will get the order.');
  const t = Date.parse(d + 'T12:00:00Z'), now = Date.now();
  if (t < now - 2 * 864e5) fail(400, 'That delivery day is in the past.');
  if (t > now + 90 * 864e5) fail(400, 'That delivery day is more than 90 days away.');
  return d;
}
async function customerLink(env, site, code) { return orderLink(site, code, await linkToken(env, code)); }
async function orderByToken(env, codeParam, tok) {
  const o = await loadOrder(env, 'code', str(codeParam, 20));
  if (!o || !tok) fail(404, 'Order not found.');
  const t = String(tok);
  if (!timingSafeEqual(o.access_hash, await sha256Hex(t)) && !(env.TOKEN_KEY && timingSafeEqual(await linkToken(env, o.code), t))) fail(404, 'Order not found.');
  return o;
}

on('POST', '/checkout/pay', async ({ env, request }) => {
  await limitOr429(env, request, 'pay', 20, 600);
  const b = await readJson(request);
  const o = await orderByToken(env, b.code, b.token);
  if (o.status === 'paid' || o.paid_at) return json({ status: 'paid', code: o.code });
  if (!['pending_payment', 'payment_failed'].includes(o.status)) fail(409, 'This checkout has expired. Please start again from your cart.');
  if (o.hold_expires_at && o.hold_expires_at < nowIso()) {
    // try to re-hold before charging
    const re = await placeHolds(env, o.id, o.items, 5);
    if (re.failed.length) { await env.DB.prepare("UPDATE orders SET status='expired', updated_at=? WHERE id=?").bind(nowIso(), o.id).run(); fail(409, 'Your checkout timed out and an item sold out. Please update your cart.'); }
    await env.DB.prepare('UPDATE orders SET hold_expires_at = ? WHERE id = ?').bind(re.expiresAt, o.id).run();
  }
  const sourceId = str(b.sourceId, 400); if (!sourceId) fail(400, 'Missing card details.');
  // Square order (idempotent per order code), priced by Square from the catalog
  const lines = await Promise.all(o.items.map(async (it) => ({ ...it, square_variation_id: (await env.DB.prepare('SELECT square_variation_id FROM variations WHERE id = ?').bind(it.variation_id).first())?.square_variation_id })));
  const sOrder = await sq.createOrder(env, o, lines, o.shipping_cents);
  const total = sOrder.total_money.amount, tax = sOrder.total_tax_money?.amount || 0;
  if (total !== o.total_cents) {
    // price or tax changed between quote and payment — store Square's numbers and ask buyer to confirm
    await env.DB.prepare('UPDATE orders SET tax_cents = ?, total_cents = ?, square_order_id = ?, updated_at = ? WHERE id = ?').bind(tax, total, sOrder.id, nowIso(), o.id).run();
    if (!b.acceptTotal || int(b.acceptTotal) !== total) fail(409, `The total changed to ${money(total)}. Please confirm to pay.`, { newTotal: total, taxCents: tax });
  }
  await env.DB.prepare('UPDATE orders SET square_order_id = ?, updated_at = ? WHERE id = ?').bind(sOrder.id, nowIso(), o.id).run();
  let pay;
  try {
    pay = await sq.createPayment(env, { sourceId, verificationToken: str(b.verificationToken, 2000) || null, amount: total, orderId: sOrder.id, o });
  } catch (e) {
    await env.DB.prepare("UPDATE orders SET status = 'payment_failed', payment_status = 'FAILED', updated_at = ? WHERE id = ?").bind(nowIso(), o.id).run();
    await event(env, o.id, 'square', 'payment_failed', e.message);
    fail(402, 'Your card was not charged: ' + (e.square?.[0]?.code === 'GENERIC_DECLINE' ? 'the card was declined.' : e.message), { retry: true });
  }
  o.items = lines;
  if (pay.status === 'COMPLETED') {
    if (await markPaid(env, { ...o, total_cents: total }, pay, 'customer')) await afterPaid(env, request, o.id);
    return json({ status: 'paid', code: o.code });
  }
  await env.DB.prepare('UPDATE orders SET payment_status = ?, square_payment_id = ?, updated_at = ? WHERE id = ?').bind(pay.status, pay.id, nowIso(), o.id).run();
  if (pay.status === 'FAILED' || pay.status === 'CANCELED') fail(402, 'Your payment did not go through. You were not charged.', { retry: true });
  return json({ status: 'processing', code: o.code, message: 'Your payment is processing. We will email you when it is confirmed.' });
});

async function afterPaid(env, request, orderId) {
  const o = await loadOrder(env, 'id', orderId);
  const site = siteUrl(request, env);
  await notify(env, 'store_new_order', o, o.items, { link: `${site}/admin/#/orders/${o.id}`, linkText: 'Open in admin' });
  await notify(env, 'customer_confirmation', o, o.items, { link: await customerLink(env, site, o.code), linkText: 'View your order' });
}

on('GET', '/orders/:code', async ({ env, params, url, request }) => {
  await limitOr429(env, request, 'orderview', 60, 60);
  const o = await orderByToken(env, params.code, url.searchParams.get('t'));
  const s = await getSettings(env);
  return json({ order: {
    code: o.code, status: o.status, fulfillment: o.fulfillment, name: o.name, created_at: o.created_at, paid_at: o.paid_at,
    pay_at_pickup: o.payment_method === 'store', discount_cents: o.discount_cents, ready_text: o.fulfillment === 'pickup' ? s.pickup_ready_text : s.shipping_time_text, hold_days: Number(s.pickup_hold_days) || 3,
    subtotal_cents: o.subtotal_cents, shipping_cents: o.shipping_cents, tax_cents: o.tax_cents, total_cents: o.total_cents, refunded_cents: o.refunded_cents,
    tracking_carrier: o.tracking_carrier, tracking_number: o.tracking_number, eta_date: o.eta_date || null, eta_note: o.eta_note || null, card: o.card_last4 ? `${o.card_brand || 'Card'} ending ${o.card_last4}` : null,
    address: o.fulfillment === 'shipping' ? { street: o.ship_street, street2: o.ship_street2, city: o.ship_city, state: o.ship_state, zip: o.ship_zip } : null,
    pickup_instructions: o.fulfillment === 'pickup' ? s.pickup_instructions : null,
    items: o.items.map((i) => ({ name: i.name, variation_name: i.variation_name, qty: i.qty, unit_cents: i.unit_cents, list_cents: i.list_cents, image_url: i.image_url, status: i.status, original_name: i.original_name })),
  } });
});

// ---------- substitution approval (customer) ----------
async function subByToken(env, tok) {
  const s = await env.DB.prepare('SELECT * FROM substitutions WHERE token_hash = ?').bind(await sha256Hex(String(tok || ''))).first();
  if (!s) fail(404, 'This link is not valid.');
  return s;
}
on('GET', '/sub/:token', async ({ env, params }) => {
  const s = await subByToken(env, params.token);
  const o = await loadOrder(env, 'id', s.order_id);
  const it = o.items.find((i) => i.id === s.order_item_id);
  return json({ status: s.status, order_code: o.code, original: { name: it.original_name || it.name, image_url: it.image_url, qty: it.qty },
    offered: { name: s.new_name, image_url: s.new_image_url, unit_cents: s.unit_cents }, refund_cents: it.unit_cents * it.qty, message: s.message,
    pay_at_pickup: o.payment_method === 'store' && !o.paid_at });
});
on('POST', '/sub/:token', async ({ env, params, request }) => {
  await limitOr429(env, request, 'sub', 20, 600);
  const b = await readJson(request);
  const s = await subByToken(env, params.token);
  if (s.status !== 'pending') fail(409, `You already ${s.status} this offer.`);
  const o = await loadOrder(env, 'id', s.order_id);
  const it = o.items.find((i) => i.id === s.order_item_id);
  const now = nowIso();
  if (b.decision === 'approve') {
    const hold = await env.DB.prepare('SELECT id FROM stock_holds WHERE order_id = ? AND variation_id = ? AND expires_at > ?').bind(o.id, s.new_variation_id, now).first();
    if (!hold) {
      const re = await placeHolds(env, o.id, [{ variation_id: s.new_variation_id, qty: it.qty }], 5);
      if (re.failed.length) { await raiseAlert(env, 'substitution_failed', `Customer approved the substitute for order ${o.code}, but it is no longer in stock.`, o.id); fail(409, 'Sorry — the replacement just sold out too. The store will contact you.'); }
    }
    const v = await env.DB.prepare('SELECT v.name AS vname, v.square_variation_id FROM variations v WHERE v.id = ?').bind(s.new_variation_id).first();
    await env.DB.batch([
      env.DB.prepare("UPDATE substitutions SET status = 'approved', responded_at = ? WHERE id = ?").bind(now, s.id),
      env.DB.prepare("UPDATE order_items SET status = 'substituted', original_name = COALESCE(original_name, name), name = ?, variation_name = ?, variation_id = ?, product_id = ?, image_url = ? WHERE id = ?")
        .bind(s.new_name, v?.vname || null, s.new_variation_id, s.new_product_id, s.new_image_url, it.id),
      env.DB.prepare('UPDATE variations SET stock = CASE WHEN stock IS NULL THEN NULL ELSE stock - ? END WHERE id = ?').bind(it.qty, s.new_variation_id),
      env.DB.prepare('DELETE FROM stock_holds WHERE order_id = ? AND variation_id = ?').bind(o.id, s.new_variation_id),
      env.DB.prepare("UPDATE orders SET status = 'processing', updated_at = ? WHERE id = ? AND status = 'awaiting_approval'").bind(now, o.id),
    ]);
    if (v?.square_variation_id && await sq.isConnected(env)) { try { await sq.adjustSold(env, v.square_variation_id, it.qty); } catch (e) { await log(env, 'warn', 'Square stock adjust for substitute failed', { e: String(e) }); } }
    await event(env, o.id, 'customer', 'substitution_approved', `${it.name} → ${s.new_name}`);
    await raiseAlert(env, 'substitution_approved', `Customer approved: ${s.new_name} instead of ${it.name} (order ${o.code}).`, o.id);
    return json({ status: 'approved' });
  }
  if (b.decision === 'decline') {
    await env.DB.batch([
      env.DB.prepare("UPDATE substitutions SET status = 'declined', responded_at = ? WHERE id = ?").bind(now, s.id),
      env.DB.prepare('DELETE FROM stock_holds WHERE order_id = ? AND variation_id = ?').bind(o.id, s.new_variation_id),
    ]);
    await event(env, o.id, 'customer', 'substitution_declined', it.name);
    const amount = itemRefundAmount(o, it);
    try { await doRefund(env, o, amount, `Item unavailable: ${it.name}`, 'customer', [it.id]); }
    catch (e) { await raiseAlert(env, 'refund_failed', `Customer declined the substitute for order ${o.code}; automatic refund of ${money(amount)} failed: ${e.message}. Refund manually.`, o.id); }
    return json({ status: 'declined', refund_cents: amount });
  }
  fail(400, 'Choose approve or decline.');
});

function itemRefundAmount(o, it) {
  const base = it.unit_cents * it.qty;
  const taxShare = o.subtotal_cents ? Math.round(o.tax_cents * base / o.subtotal_cents) : 0;
  return Math.min(base + taxShare, o.total_cents - o.refunded_cents);
}

async function doRefund(env, o, amount, reason, actor, itemIds) {
  if (o.payment_method === 'store' && !o.paid_at) return removeUnpaidItems(env, o, reason, actor, itemIds);
  if (!o.square_payment_id) fail(400, o.payment_method === 'store' ? 'This order was paid at the store. Give the refund at the counter, then add a note here.' : 'This order has no Square payment to refund.');
  if (amount <= 0 || amount > o.total_cents - o.refunded_cents) fail(400, `Refund must be between $0.01 and ${money(o.total_cents - o.refunded_cents)}.`);
  const r = await sq.refund(env, o.square_payment_id, amount, reason);
  const now = nowIso(), newRef = o.refunded_cents + amount, full = newRef >= o.total_cents;
  const stmts = [env.DB.prepare(`UPDATE orders SET refunded_cents = ?, status = CASE WHEN ? THEN 'refunded' ELSE status END, updated_at = ? WHERE id = ?`).bind(newRef, full ? 1 : 0, now, o.id)];
  for (const id of itemIds || []) stmts.push(env.DB.prepare("UPDATE order_items SET status = 'refunded', refunded_cents = unit_cents * qty WHERE id = ?").bind(id));
  if (full) stmts.push(env.DB.prepare("UPDATE order_items SET status = 'refunded' WHERE order_id = ? AND status IN ('ok','unavailable','awaiting_approval')").bind(o.id));
  stmts.push(env.DB.prepare('INSERT INTO order_events (order_id, actor, action, detail, at) VALUES (?, ?, ?, ?, ?)').bind(o.id, actor, 'refund', `${money(amount)} — ${reason} (Square refund ${r.id}, ${r.status})`, now));
  await env.DB.batch(stmts);
  // any remaining items fine? if every item is refunded mark refunded
  const left = await env.DB.prepare("SELECT COUNT(*) AS n FROM order_items WHERE order_id = ? AND status NOT IN ('refunded','canceled')").bind(o.id).first();
  if (!left.n) await env.DB.prepare("UPDATE orders SET status = 'refunded', updated_at = ? WHERE id = ?").bind(now, o.id).run();
  else if (o.status === 'awaiting_approval') {
    const pend = await env.DB.prepare("SELECT COUNT(*) AS n FROM order_items WHERE order_id = ? AND status IN ('awaiting_approval','unavailable')").bind(o.id).first();
    if (!pend.n) await env.DB.prepare("UPDATE orders SET status = 'processing', updated_at = ? WHERE id = ?").bind(now, o.id).run();
  }
  await notify(env, 'refund', o, o.items, { amount, reason });
  return r;
}

// ======================================================================
// SQUARE: OAuth callback + webhooks
// ======================================================================
on('GET', '/square/callback', async ({ env, url, request }) => {
  const site = siteUrl(request, env);
  if (url.searchParams.get('error')) return Response.redirect(`${site}/admin/#/settings?square=denied`, 302);
  try { await sq.completeOAuth(env, str(url.searchParams.get('code'), 500), str(url.searchParams.get('state'), 100), `${site}/api/square/callback`); }
  catch (e) { await log(env, 'error', 'Square connect failed', { e: e.message }); return Response.redirect(`${site}/admin/#/settings?square=error&msg=${encodeURIComponent(e.message)}`, 302); }
  return Response.redirect(`${site}/admin/#/settings?square=connected`, 302);
});

on('POST', '/square/webhook', async ({ env, request, waitUntil }) => {
  const raw = await request.text();
  const notifUrl = env.SQUARE_WEBHOOK_URL || `${siteUrl(request, env)}/api/square/webhook`;
  if (!(await sq.verifyWebhook(env, raw, request.headers.get('x-square-hmacsha256-signature'), notifUrl))) {
    await log(env, 'warn', 'Rejected webhook with bad signature');
    return new Response('Invalid signature', { status: 403 });
  }
  let evt; try { evt = JSON.parse(raw); } catch { return new Response('Bad JSON', { status: 400 }); }
  const ins = await env.DB.prepare('INSERT OR IGNORE INTO webhook_events (event_id, type, received_at) VALUES (?, ?, ?)').bind(String(evt.event_id || ''), evt.type || '', nowIso()).run();
  if (!ins.meta.changes) return new Response('Duplicate ignored', { status: 200 });
  waitUntil(handleEvent(env, request, evt).catch((e) => log(env, 'error', 'Webhook handling failed', { type: evt.type, e: String(e) })));
  return new Response('OK', { status: 200 });
});

async function handleEvent(env, request, evt) {
  const obj = evt.data?.object || {};
  if (evt.type === 'payment.created' || evt.type === 'payment.updated') {
    const p = obj.payment; if (!p) return;
    const o = p.order_id && await loadOrder(env, 'square_order_id', p.order_id) || p.reference_id && await loadOrder(env, 'code', p.reference_id);
    if (!o) return;
    if (p.status === 'COMPLETED') { if (await markPaid(env, o, p, 'square')) await afterPaid(env, request, o.id); }
    else if ((p.status === 'FAILED' || p.status === 'CANCELED') && o.status === 'pending_payment') {
      await env.DB.prepare("UPDATE orders SET status = 'payment_failed', payment_status = ?, updated_at = ? WHERE id = ?").bind(p.status, nowIso(), o.id).run();
      await event(env, o.id, 'square', 'payment_' + p.status.toLowerCase(), p.id);
    }
  } else if (evt.type === 'refund.updated' || evt.type === 'refund.created') {
    const r = obj.refund; if (!r) return;
    const o = await loadOrder(env, 'square_payment_id', r.payment_id); if (!o) return;
    await event(env, o.id, 'square', 'refund_' + String(r.status).toLowerCase(), `${money(r.amount_money?.amount)} (${r.id})`);
    if (r.status === 'FAILED' || r.status === 'REJECTED') await raiseAlert(env, 'refund_failed', `Square refund ${r.id} for order ${o.code} ${r.status}.`, o.id);
  } else if (evt.type === 'inventory.count.updated') {
    const c = await sq.connection(env);
    for (const ct of obj.inventory_counts || []) {
      if (ct.state !== 'IN_STOCK' || (c?.locationId && ct.location_id !== c.locationId)) continue;
      const q = Math.floor(Number(ct.quantity));
      const v = await env.DB.prepare('SELECT v.id, v.stock, p.name FROM variations v JOIN products p ON p.id = v.product_id WHERE v.square_variation_id = ?').bind(ct.catalog_object_id).first();
      if (!v) continue;
      await env.DB.prepare('UPDATE variations SET stock = ? WHERE id = ?').bind(q, v.id).run();
      if (q < 0) await raiseAlert(env, 'oversold', `${v.name}: Square shows ${q} in stock (oversold). Check recent website orders for this item.`);
    }
  } else if (evt.type === 'catalog.version.updated') {
    await pullLinkedCatalog(env);
  }
}

async function pullLinkedCatalog(env) {
  const linked = (await env.DB.prepare('SELECT id, square_item_id FROM products WHERE square_item_id IS NOT NULL').all()).results;
  if (!linked.length) return 0;
  const items = await sq.listCatalog(env, 'ITEM');
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  const now = nowIso(); const stmts = [];
  for (const p of linked) {
    const it = byId[p.square_item_id]; if (!it || it.is_deleted) continue;
    stmts.push(env.DB.prepare('UPDATE products SET name = ?, description = ?, updated_at = ? WHERE id = ?').bind(it.item_data?.name || 'Item', it.item_data?.description || '', now, p.id));
    for (const v of it.item_data?.variations || []) {
      const amt = v.item_variation_data?.price_money?.amount;
      if (amt != null) stmts.push(env.DB.prepare('UPDATE variations SET price_cents = ?, name = ?, sku = ? WHERE square_variation_id = ?').bind(amt, v.item_variation_data.name || 'Regular', v.item_variation_data.sku || null, v.id));
    }
  }
  if (stmts.length) await env.DB.batch(stmts);
  return linked.length;
}

// ======================================================================
// ADMIN — auth
// ======================================================================
on('GET', '/admin/bootstrap', async ({ env }) => {
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM staff').first();
  return json({ needsSetup: !n.n, setupKeyConfigured: !!env.ADMIN_SETUP_KEY });
});
on('POST', '/admin/setup', async ({ env, request }) => {
  await limitOr429(env, request, 'setup', 5, 900);
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM staff').first();
  if (n.n) fail(409, 'The owner account already exists. Please log in.');
  const b = await readJson(request);
  if (!env.ADMIN_SETUP_KEY || !timingSafeEqual(String(b.setupKey || ''), env.ADMIN_SETUP_KEY)) fail(403, 'Setup key is not correct.');
  const email = str(b.email, 120).toLowerCase(), name = str(b.name, 60);
  if (!isEmail(email) || name.length < 2) fail(400, 'Enter a name and valid email.');
  const pp = passwordProblem(b.password); if (pp) fail(400, pp);
  const r = await env.DB.prepare("INSERT INTO staff (email, name, role, pass_hash, created_at) VALUES (?, ?, 'owner', ?, ?) RETURNING id").bind(email, name, await hashPassword(b.password), nowIso()).first();
  if (!(await getSettings(env)).store_email) await setSetting(env, 'store_email', email);
  await activity(env, { id: r.id, email }, 'Created the owner account', null, request);
  return json({ ok: true }, 200, { 'Set-Cookie': await createSession(env, r.id, request) });
});
on('POST', '/admin/login', async ({ env, request }) => {
  await limitOr429(env, request, 'login', 8, 600);
  const b = await readJson(request);
  const email = str(b.email, 120).toLowerCase();
  await limitOr429(env, { headers: new Headers({ 'cf-connecting-ip': 'acct:' + email }) }, 'login-acct', 10, 900);
  const st = await env.DB.prepare('SELECT * FROM staff WHERE email = ? AND active = 1').bind(email).first();
  const ok = st ? await verifyPassword(String(b.password || ''), st.pass_hash) : (await hashPassword('x'), false);
  if (!ok) { await log(env, 'warn', 'Failed admin login', { email }); if (st) await activity(env, st, 'Failed login attempt (wrong password)', null, request); fail(401, 'Email or password is not correct.'); }
  await activity(env, st, 'Logged in', null, request);
  return json({ ok: true, staff: { name: st.name, email: st.email, role: st.role } }, 200, { 'Set-Cookie': await createSession(env, st.id, request) });
});
on('POST', '/admin/logout', async ({ env, request }) => { const who = await destroySession(env, request); if (who) await activity(env, who, 'Logged out', null, request); return json({ ok: true }, 200, { 'Set-Cookie': clearCookie() }); });
on('GET', '/admin/me', async ({ env, request }) => json({ staff: await requireStaff(env, request), permLabels: PERMS }));
on('POST', '/admin/password', async ({ env, request }) => {
  const me = await requireStaff(env, request); const b = await readJson(request);
  const st = await env.DB.prepare('SELECT pass_hash FROM staff WHERE id = ?').bind(me.id).first();
  if (!(await verifyPassword(String(b.current || ''), st.pass_hash))) fail(400, 'Current password is not correct.');
  const pp = passwordProblem(b.password); if (pp) fail(400, pp);
  await env.DB.batch([env.DB.prepare('UPDATE staff SET pass_hash = ? WHERE id = ?').bind(await hashPassword(b.password), me.id), env.DB.prepare('DELETE FROM sessions WHERE staff_id = ?').bind(me.id)]);
  return json({ ok: true }, 200, { 'Set-Cookie': await createSession(env, me.id, request) });
});

// ---------- staff (owner) ----------
on('GET', '/admin/staff', async ({ env, request }) => {
  await requireStaff(env, request, 'staff');
  const rows = (await env.DB.prepare(`SELECT s.id, s.email, s.name, s.role, s.perms, s.active, s.created_at, s.last_login,
      (SELECT MAX(last_seen) FROM sessions se WHERE se.staff_id = s.id AND se.expires_at > ?) AS last_seen,
      (SELECT action || ' · ' || at FROM staff_activity a WHERE a.staff_id = s.id ORDER BY a.id DESC LIMIT 1) AS last_action
    FROM staff s ORDER BY s.id`).bind(nowIso()).all()).results;
  const online = Date.now() - 5 * 60e3;
  return json({ permLabels: PERMS, staff: rows.map((r) => ({ ...r, perms: permsOf(r), online: !!(r.last_seen && Date.parse(r.last_seen) > online) })) });
});
on('POST', '/admin/staff', async ({ env, request }) => {
  await requireStaff(env, request, 'staff'); const b = await readJson(request);
  const email = str(b.email, 120).toLowerCase(), name = str(b.name, 60), role = b.role === 'owner' ? 'owner' : 'employee';
  if (!isEmail(email) || name.length < 2) fail(400, 'Enter a name and valid email.');
  if (role === 'owner' && request.__staff.role !== 'owner') fail(403, 'Only an owner can add an owner.');
  if (cleanPerms(b.perms).some((p) => OWNER_ONLY_PERMS.includes(p)) && request.__staff.role !== 'owner') fail(403, 'Only an owner can give staff-management or AI assistant access.');
  const pp = passwordProblem(b.password); if (pp) fail(400, pp);
  try { await env.DB.prepare('INSERT INTO staff (email, name, role, perms, pass_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(email, name, role, JSON.stringify(cleanPerms(b.perms || ['orders', 'products', 'stock'])), await hashPassword(b.password), nowIso()).run(); }
  catch (e) { if (String(e).includes('UNIQUE')) fail(409, 'That email already has an account.'); throw e; }
  return json({ ok: true });
});
on('PUT', '/admin/staff/:id', async ({ env, request, params }) => {
  const me = await requireStaff(env, request, 'staff'); const b = await readJson(request); const id = int(params.id, 1);
  if (id === me.id && (b.active === false || b.role === 'employee' || Array.isArray(b.perms))) fail(400, 'You cannot change your own access.');
  const target = await env.DB.prepare('SELECT role FROM staff WHERE id = ?').bind(id).first(); if (!target) fail(404, 'Staff member not found');
  if (me.role !== 'owner' && (target.role === 'owner' || b.role || (Array.isArray(b.perms) && b.perms.some((p) => OWNER_ONLY_PERMS.includes(p))))) fail(403, 'Only an owner can change owners, roles, staff permission or AI assistant access.');
  const sets = [], vals = [];
  if (b.role) { sets.push('role = ?'); vals.push(b.role === 'owner' ? 'owner' : 'employee'); }
  if (Array.isArray(b.perms)) { sets.push('perms = ?'); vals.push(JSON.stringify(cleanPerms(b.perms))); }
  if (typeof b.active === 'boolean') { sets.push('active = ?'); vals.push(b.active ? 1 : 0); }
  if (b.password) { const pp = passwordProblem(b.password); if (pp) fail(400, pp); sets.push('pass_hash = ?'); vals.push(await hashPassword(b.password)); }
  if (!sets.length) fail(400, 'Nothing to change.');
  await env.DB.batch([env.DB.prepare(`UPDATE staff SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, id), env.DB.prepare('DELETE FROM sessions WHERE staff_id = ?').bind(id)]);
  return json({ ok: true });
});


// ---------- invite links (owner/staff permission) ----------
on('POST', '/admin/invites', async ({ env, request }) => {
  const me = await requireStaff(env, request, 'staff'); const b = await readJson(request);
  const full = !!b.full;
  if (full && me.role !== 'owner') fail(403, 'Only an owner can invite someone with full access.');
  const perms = full ? Object.keys(PERMS) : cleanPerms(b.perms);
  if (!perms.length) fail(400, 'Pick at least one permission.');
  if (!full && perms.some((p) => OWNER_ONLY_PERMS.includes(p)) && me.role !== 'owner') fail(403, 'Only an owner can give staff-management or AI assistant access.');
  const days = int(b.days, 1, 30) || 7, tok = makeToken(24), now = nowIso();
  const email = str(b.email, 120).toLowerCase(); if (email && !isEmail(email)) fail(400, 'That email is not valid.');
  await env.DB.prepare('INSERT INTO invites (token_hash, name, email, role, perms, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(await sha256Hex(tok), str(b.name, 60) || null, email || null, full ? 'owner' : 'employee', JSON.stringify(perms), me.id, now, new Date(Date.now() + days * 864e5).toISOString()).run();
  return json({ link: `${siteUrl(request, env)}/admin/#/join?t=${tok}`, expires_days: days });
});
on('GET', '/admin/invites', async ({ env, request }) => {
  await requireStaff(env, request, 'staff');
  const rows = (await env.DB.prepare(`SELECT i.id, i.name, i.email, i.role, i.perms, i.created_at, i.expires_at, i.used_at, i.revoked, s.name AS used_by_name, c.name AS created_by_name
    FROM invites i LEFT JOIN staff s ON s.id = i.used_by LEFT JOIN staff c ON c.id = i.created_by ORDER BY i.id DESC LIMIT 50`).all()).results;
  return json({ invites: rows.map((r) => ({ ...r, perms: JSON.parse(r.perms), state: r.revoked ? 'canceled' : r.used_at ? 'used' : r.expires_at < nowIso() ? 'expired' : 'open' })) });
});
on('DELETE', '/admin/invites/:id', async ({ env, request, params }) => {
  await requireStaff(env, request, 'staff');
  await env.DB.prepare('UPDATE invites SET revoked = 1 WHERE id = ? AND used_at IS NULL').bind(int(params.id, 1)).run();
  return json({ ok: true });
});
async function openInvite(env, tok) {
  const i = await env.DB.prepare('SELECT * FROM invites WHERE token_hash = ?').bind(await sha256Hex(String(tok || ''))).first();
  if (!i || i.revoked) fail(404, 'This invite link is not valid. Ask the owner for a new one.');
  if (i.used_at) fail(409, 'This invite link was already used. Log in instead.');
  if (i.expires_at < nowIso()) fail(410, 'This invite link expired. Ask the owner for a new one.');
  return i;
}
on('GET', '/admin/join/:token', async ({ env, request, params }) => {
  await limitOr429(env, request, 'join', 30, 600);
  const i = await openInvite(env, params.token);
  const perms = JSON.parse(i.perms);
  return json({ name: i.name, email: i.email, full: i.role === 'owner', perms: perms.map((p) => PERMS[p]) });
});
on('POST', '/admin/join/:token', async ({ env, request, params }) => {
  await limitOr429(env, request, 'join', 10, 600);
  const i = await openInvite(env, params.token); const b = await readJson(request);
  const email = str(b.email || i.email, 120).toLowerCase(), name = str(b.name || i.name, 60);
  if (!isEmail(email) || name.length < 2) fail(400, 'Enter your name and a valid email.');
  if (i.email && email !== i.email) fail(400, `This invite is for ${i.email}.`);
  const pp = passwordProblem(b.password); if (pp) fail(400, pp);
  if (await env.DB.prepare('SELECT id FROM staff WHERE email = ?').bind(email).first()) fail(409, 'That email already has an account. Log in instead.');
  const st = await env.DB.prepare('INSERT INTO staff (email, name, role, perms, pass_hash, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id')
    .bind(email, name, i.role, i.perms, await hashPassword(b.password), nowIso()).first();
  const used = await env.DB.prepare('UPDATE invites SET used_at = ?, used_by = ? WHERE id = ? AND used_at IS NULL').bind(nowIso(), st.id, i.id).run();
  if (!used.meta.changes) { await env.DB.prepare('DELETE FROM staff WHERE id = ?').bind(st.id).run(); fail(409, 'This invite link was already used.'); }
  await activity(env, { id: st.id, email }, 'Joined with an invite link', null, request);
  return json({ ok: true }, 200, { 'Set-Cookie': await createSession(env, st.id, request) });
});
on('GET', '/admin/activity', async ({ env, request, url }) => {
  await requireStaff(env, request, 'staff');
  const qs = (k) => (url.searchParams.get(k) ? int(url.searchParams.get(k), 1) : null);
  const sid = qs('staff'), before = qs('before');
  const w = [], v = [];
  if (sid) { w.push('a.staff_id = ?'); v.push(sid); }
  if (before) { w.push('a.id < ?'); v.push(before); }
  const rows = (await env.DB.prepare(`SELECT a.id, a.staff_id, a.email, a.action, a.detail, a.path, a.ip, a.at, s.name FROM staff_activity a LEFT JOIN staff s ON s.id = a.staff_id
    ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY a.id DESC LIMIT 101`).bind(...v).all()).results;
  return json({ activity: rows.slice(0, 100), more: rows.length > 100 });
});

// ======================================================================
// ADMIN — dashboard
// Pay-at-pickup order not paid yet: nothing to refund, the item is simply taken off what they owe.
async function removeUnpaidItems(env, o, reason, actor, itemIds) {
  const ids = (itemIds || []).length ? itemIds : o.items.filter((i) => !['refunded', 'canceled'].includes(i.status)).map((i) => i.id);
  const drop = o.items.filter((i) => ids.includes(i.id)), cut = drop.reduce((t, i) => t + i.unit_cents * i.qty, 0), now = nowIso();
  const stmts = drop.map((i) => env.DB.prepare("UPDATE order_items SET status = 'canceled' WHERE id = ?").bind(i.id));
  stmts.push(env.DB.prepare('UPDATE orders SET subtotal_cents = subtotal_cents - ?, total_cents = total_cents - ?, updated_at = ? WHERE id = ?').bind(cut, cut, now, o.id));
  stmts.push(env.DB.prepare('INSERT INTO order_events (order_id, actor, action, detail, at) VALUES (?, ?, ?, ?, ?)').bind(o.id, actor, 'item_removed', `${drop.map((i) => i.name).join(', ')} removed — ${reason}. Customer had not paid, nothing to refund.`, now));
  await env.DB.batch(stmts);
  const left = await env.DB.prepare("SELECT COUNT(*) AS n FROM order_items WHERE order_id = ? AND status NOT IN ('refunded','canceled')").bind(o.id).first();
  if (!left.n) await env.DB.prepare("UPDATE orders SET status = 'canceled', updated_at = ? WHERE id = ?").bind(now, o.id).run();
  else if (o.status === 'awaiting_approval') {
    const pend = await env.DB.prepare("SELECT COUNT(*) AS n FROM order_items WHERE order_id = ? AND status IN ('awaiting_approval','unavailable')").bind(o.id).first();
    if (!pend.n) await env.DB.prepare("UPDATE orders SET status = 'processing', updated_at = ? WHERE id = ?").bind(now, o.id).run();
  }
  return { id: 'none', status: 'NOT_CHARGED' };
}

// ======================================================================
// ADMIN — contradiction check + AI assistant
// ======================================================================
// Runs another admin API call internally, as the same signed-in person (same permission checks, same activity log).
async function internalCall(ctx, method, path, body) {
  const src = ctx.request;
  const h = new Headers({ 'X-Ageless-Admin': '1', 'X-Ageless-Via': 'assistant', 'Content-Type': 'application/json' });
  for (const k of ['Cookie', 'CF-Connecting-IP', 'User-Agent']) if (src.headers.get(k)) h.set(k, src.headers.get(k));
  const req = new Request(new URL('/api' + path, src.url), { method, headers: h, body: method === 'GET' || method === 'DELETE' ? undefined : JSON.stringify(body || {}) });
  const res = await onRequest({ ...ctx, request: req });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
on('POST', '/admin/check', async ({ env, request }) => {
  const me = await requireStaff(env, request); const b = await readJson(request);
  const kind = b.kind === 'product' ? 'product' : 'settings', data = b.data && typeof b.data === 'object' ? b.data : {};
  const s = await getSettings(env);
  const categories = (await env.DB.prepare('SELECT id, name FROM categories ORDER BY sort').all()).results;
  const ctx = { settings: s, categories, squareConnected: await sq.isConnected(env) };
  if (kind === 'product') {
    const pid = int(b.productId, 1);
    ctx.hasPhoto = pid ? !!(await env.DB.prepare('SELECT id FROM product_images WHERE product_id = ? LIMIT 1').bind(pid).first()) : !!b.hasPhoto;
    ctx.salePct = salePercent(s, data.category_id || null); ctx.saleApplies = !!ctx.salePct;
  }
  const issues = ruleCheck(kind, data, ctx);
  let ai = null;
  if (me.perms.includes('ai') && aiConfigured(env)) {
    const slim = kind === 'settings' ? { squareConnected: ctx.squareConnected, current: Object.fromEntries(Object.entries(s).filter(([k]) => !k.startsWith('sq_'))), categories } : { categories, saleRunning: ctx.salePct || 0 };
    ai = await aiReview(env, kind, data, slim, issues);
    if (ai) issues.push(...ai.issues);
  }
  return json({ issues, ai: !!ai, aiNote: ai?.note || null });
});
on('GET', '/admin/ai/status', async ({ env, request }) => {
  const me = await requireStaff(env, request);
  return json({ configured: aiConfigured(env), allowed: me.perms.includes('ai'), model: env.GROQ_MODEL || 'openai/gpt-oss-120b' });
});
on('POST', '/admin/ai/chat', async (ctx) => {
  const { env, request } = ctx;
  const me = await requireStaff(env, request, 'ai'); const b = await readJson(request);
  await limitOr429(env, request, 'ai:' + me.id, 40, 600);
  const history = (Array.isArray(b.messages) ? b.messages : []).filter((m) => m && typeof m.content === 'string').slice(-16);
  if (!history.length) fail(400, 'Ask something.');
  try { return json(await aiChat(env, me, history, (method, path, body) => internalCall(ctx, method, path, body))); }
  catch (e) { await log(env, 'warn', 'AI chat failed', { e: String(e) }); fail(502, e.message || 'The assistant is unavailable right now.'); }
});
on('POST', '/admin/ai/apply', async (ctx) => {
  const { env, request } = ctx;
  await requireStaff(env, request, 'ai'); const b = await readJson(request);
  const actions = (Array.isArray(b.actions) ? b.actions : []).slice(0, 20);
  if (!actions.length) fail(400, 'Nothing to apply.');
  const results = [];
  for (const a0 of actions) {
    const a = { method: String(a0.method || '').toUpperCase(), path: a0.path, body: a0.body };
    if (!allowedPath(a.method, a.path) || a.method === 'GET') { results.push({ ok: false, error: 'Not allowed through the assistant.' }); continue; }
    if (riskOf(a) && !b.sure) { results.push({ ok: false, error: 'This is a risky change and needs "Yes, I\'m sure".' }); continue; }
    const r = await internalCall(ctx, a.method, a.path, a.body);
    results.push(r.status < 400 ? { ok: true } : { ok: false, error: r.data?.error || `Error ${r.status}` });
    if (r.status >= 400) break; // stop on first failure so later steps don't run on a half-done change
  }
  return json({ results });
});

// ======================================================================
on('GET', '/admin/dashboard', async ({ env, request }) => {
  await requireStaff(env, request);
  await cleanupExpired(env);
  const PAID = "('paid','processing','awaiting_approval','ready_for_pickup','shipped','completed','refunded')";
  const day = new Date(); day.setHours(0, 0, 0, 0);
  const since = (d) => new Date(Date.now() - d * 864e5).toISOString();
  const rev = async (from) => (await env.DB.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(total_cents - refunded_cents), 0) AS cents FROM orders WHERE status IN ${PAID} AND paid_at >= ?`).bind(from).first());
  const [today, week, month, all] = await Promise.all([rev(day.toISOString()), rev(since(7)), rev(since(30)), rev('0')]);
  const byStatus = (await env.DB.prepare('SELECT status, COUNT(*) AS n FROM orders GROUP BY status').all()).results;
  const lowStock = (await env.DB.prepare(`SELECT p.id, p.name, v.name AS vname, v.stock FROM variations v JOIN products p ON p.id = v.product_id WHERE p.status = 'active' AND v.stock IS NOT NULL AND v.stock <= 2 ORDER BY v.stock LIMIT 20`).all()).results;
  const noQty = await env.DB.prepare("SELECT COUNT(DISTINCT p.id) AS n FROM variations v JOIN products p ON p.id = v.product_id WHERE p.status = 'active' AND v.stock IS NULL").first();
  const alerts = (await env.DB.prepare('SELECT * FROM alerts WHERE resolved = 0 ORDER BY id DESC LIMIT 20').all()).results;
  const recent = (await env.DB.prepare(`SELECT id, code, name, fulfillment, status, total_cents, created_at FROM orders WHERE status NOT IN ('expired') ORDER BY id DESC LIMIT 8`).all()).results;
  const c = await sq.connection(env);
  const unsent = await env.DB.prepare("SELECT COUNT(*) AS n FROM outbox WHERE status != 'sent'").first();
  const me = request.__staff;
  return json({ revenue: me.perms.includes('sales') ? { today, week, month, all } : null, byStatus, lowStock, noQuantity: noQty.n, alerts, recent,
    square: { appConfigured: sq.appConfigured(env), connected: await sq.isConnected(env), env: sq.squareEnv(env), location: c?.locationName || null },
    email: { configured: !!(env.RESEND_API_KEY && env.EMAIL_FROM), unsent: unsent.n } });
});
on('POST', '/admin/alerts/:id/resolve', async ({ env, request, params }) => {
  await requireStaff(env, request);
  await env.DB.prepare('UPDATE alerts SET resolved = 1 WHERE id = ?').bind(int(params.id, 1)).run();
  return json({ ok: true });
});

// ======================================================================
// ADMIN — orders
// ======================================================================
on('GET', '/admin/orders', async ({ env, request, url }) => {
  await requireStaff(env, request, 'orders');
  const w = ["status != 'expired'"], v = [];
  const st = str(url.searchParams.get('status'), 30); if (st && st !== 'all') { if (st === 'open') w.push("status IN ('paid','processing','awaiting_approval','ready_for_pickup')"); else { w.push('status = ?'); v.push(st); } }
  const f = url.searchParams.get('fulfillment'); if (f === 'pickup' || f === 'shipping') { w.push('fulfillment = ?'); v.push(f); }
  const q = str(url.searchParams.get('q'), 80); if (q) { w.push('(code LIKE ? OR name LIKE ? OR email LIKE ? OR phone LIKE ?)'); v.push(...Array(4).fill('%' + q + '%')); }
  const from = str(url.searchParams.get('from'), 10), to = str(url.searchParams.get('to'), 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) { w.push('created_at >= ?'); v.push(from); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) { w.push('created_at < ?'); v.push(new Date(Date.parse(to) + 864e5).toISOString()); }
  const page = int(url.searchParams.get('page'), 1, 1000) || 1;
  const rows = (await env.DB.prepare(`SELECT o.id, o.code, o.status, o.fulfillment, o.name, o.email, o.phone, o.ship_city, o.ship_state, o.total_cents, o.refunded_cents, o.created_at, o.paid_at, o.payment_method,
      (SELECT SUM(qty) FROM order_items WHERE order_id = o.id) AS item_count,
      (SELECT image_url FROM order_items WHERE order_id = o.id ORDER BY id LIMIT 1) AS image_url
    FROM orders o WHERE ${w.join(' AND ')} ORDER BY o.id DESC LIMIT 51 OFFSET ?`).bind(...v, (page - 1) * 50).all()).results;
  return json({ orders: rows.slice(0, 50), more: rows.length > 50 });
});
on('GET', '/admin/orders/:id', async ({ env, request, params }) => {
  await requireStaff(env, request, 'orders');
  const o = await loadOrder(env, 'id', int(params.id, 1)); if (!o) fail(404, 'Order not found');
  delete o.access_hash;
  o.events = (await env.DB.prepare('SELECT actor, action, detail, at FROM order_events WHERE order_id = ? ORDER BY id DESC').bind(o.id).all()).results;
  o.substitutions = (await env.DB.prepare('SELECT id, order_item_id, new_name, new_image_url, unit_cents, status, created_at, responded_at FROM substitutions WHERE order_id = ? ORDER BY id DESC').bind(o.id).all()).results;
  o.emails = (await env.DB.prepare('SELECT id, to_email, subject, status, created_at FROM outbox WHERE order_id = ? ORDER BY id DESC').bind(o.id).all()).results;
  o.delivery_days = Number((await getSettings(env)).delivery_days) || 4;
  return json({ order: o });
});
on('POST', '/admin/orders/:id/status', async ({ env, request, params }) => {
  const me = await requireStaff(env, request, 'orders'); const b = await readJson(request);
  const o = await loadOrder(env, 'id', int(params.id, 1)); if (!o) fail(404, 'Order not found');
  const to = str(b.status, 30);
  if (to === 'canceled') fail(400, 'Use Cancel & refund to cancel a paid order.');
  assertTransition(o.status, to);
  if (to === 'ready_for_pickup' && o.fulfillment !== 'pickup') fail(400, 'Only pickup orders can be marked ready for pickup.');
  if (to === 'shipped' && o.fulfillment !== 'shipping') fail(400, 'Only shipping orders can be marked shipped.');
  if (to === 'completed' && o.payment_method === 'store' && !o.paid_at) fail(400, 'This order is not paid yet. Use "Paid & picked up" when the customer pays at the counter.');
  if (o.items.some((i) => i.status === 'awaiting_approval' || i.status === 'unavailable') && ['ready_for_pickup', 'shipped', 'completed'].includes(to)) fail(400, 'Resolve the unavailable item first (substitute or refund).');
  const carrier = str(b.carrier, 40) || null, tracking = str(b.tracking, 60) || null;
  const eta = to === 'shipped' ? etaDate(b.eta_date) : null, etaNote = to === 'shipped' ? (str(b.eta_note, 200) || null) : null;
  await env.DB.prepare('UPDATE orders SET status = ?, tracking_carrier = COALESCE(?, tracking_carrier), tracking_number = COALESCE(?, tracking_number), eta_date = COALESCE(?, eta_date), eta_note = COALESCE(?, eta_note), updated_at = ? WHERE id = ?').bind(to, carrier, tracking, eta, etaNote, nowIso(), o.id).run();
  await event(env, o.id, me.email, 'status', `${o.status} → ${to}${eta ? ' · arriving ' + eta : ''}${tracking ? ' (' + (carrier || '') + ' ' + tracking + ')' : ''}`);
  const fresh = await loadOrder(env, 'id', o.id), site = siteUrl(request, env);
  if (to === 'ready_for_pickup') await notify(env, 'ready_for_pickup', fresh, fresh.items, { link: await customerLink(env, site, o.code) });
  if (to === 'shipped') await notify(env, 'shipped', fresh, fresh.items, { link: await customerLink(env, site, o.code) });
  return json({ ok: true });
});
// Change the promised delivery day (or tracking) after an order has shipped; emails the customer.
on('POST', '/admin/orders/:id/eta', async ({ env, request, params }) => {
  const me = await requireStaff(env, request, 'orders'); const b = await readJson(request);
  const o = await loadOrder(env, 'id', int(params.id, 1)); if (!o) fail(404, 'Order not found');
  if (o.fulfillment !== 'shipping' || o.status !== 'shipped') fail(400, 'You can change the delivery date only on a shipped delivery order.');
  const eta = etaDate(b.eta_date), note = str(b.eta_note, 200) || null;
  const carrier = str(b.carrier, 40) || null, tracking = str(b.tracking, 60) || null;
  await env.DB.prepare('UPDATE orders SET eta_date = ?, eta_note = ?, tracking_carrier = COALESCE(?, tracking_carrier), tracking_number = COALESCE(?, tracking_number), updated_at = ? WHERE id = ?').bind(eta, note, carrier, tracking, nowIso(), o.id).run();
  await event(env, o.id, me.email, 'eta', `Delivery date ${o.eta_date || '(none)'} → ${eta}`);
  const fresh = await loadOrder(env, 'id', o.id);
  const sent = b.notify === false ? 'skipped' : await notify(env, 'delivery_update', fresh, fresh.items, { link: await customerLink(env, siteUrl(request, env), o.code) });
  return json({ ok: true, email: sent });
});
on('POST', '/admin/orders/:id/items/:iid/remove', async ({ env, request, params }) => {
  const me = await requireStaff(env, request, 'orders');
  const o = await loadOrder(env, 'id', int(params.id, 1)); if (!o) fail(404, 'Order not found');
  if (o.payment_method !== 'store' || o.paid_at) fail(400, 'This order is paid — use Refund instead.');
  const it = o.items.find((i) => i.id === int(params.iid, 1)); if (!it) fail(404, 'Item not found');
  await removeUnpaidItems(env, o, 'Item unavailable', me.email, [it.id]);
  return json({ ok: true });
});
// Pay at pickup: customer paid at the counter (marks paid; optionally completes the order).
on('POST', '/admin/orders/:id/paid-in-store', async ({ env, request, params }) => {
  const me = await requireStaff(env, request, 'orders'); const b = await readJson(request);
  const o = await loadOrder(env, 'id', int(params.id, 1)); if (!o) fail(404, 'Order not found');
  if (o.payment_method !== 'store' || o.paid_at) fail(400, 'This order is already paid.');
  if (!['processing', 'ready_for_pickup', 'awaiting_approval'].includes(o.status)) fail(400, 'This order cannot be marked paid.');
  if (o.items.some((i) => i.status === 'awaiting_approval' || i.status === 'unavailable')) fail(400, 'Resolve the unavailable item first (substitute or remove it).');
  const how = ['cash', 'card', 'other'].includes(b.method) ? b.method : 'other', now = nowIso();
  const done = b.complete !== false;
  await env.DB.prepare(`UPDATE orders SET paid_at = ?, payment_status = ?, status = ?, updated_at = ? WHERE id = ?`).bind(now, 'PAID_IN_STORE_' + how.toUpperCase(), done ? 'completed' : o.status, now, o.id).run();
  await event(env, o.id, me.email, 'paid_in_store', `Paid at the counter (${how}) — ${money(o.total_cents)} before any sales tax rung up in store${done ? '; picked up' : ''}`);
  return json({ ok: true });
});
// Pay at pickup: customer never came / doesn't want it. Nothing was charged; items go back on the shelf.
on('POST', '/admin/orders/:id/cancel-unpaid', async ({ env, request, params }) => {
  const me = await requireStaff(env, request, 'orders'); const b = await readJson(request);
  const o = await loadOrder(env, 'id', int(params.id, 1)); if (!o) fail(404, 'Order not found');
  if (o.payment_method !== 'store' || o.paid_at) fail(400, 'Only unpaid pay-at-pickup orders can be canceled this way. Use Cancel & refund for paid orders.');
  if (['canceled', 'completed', 'expired'].includes(o.status)) fail(400, 'This order is already closed.');
  const reason = str(b.reason, 150) || 'Not picked up', now = nowIso();
  const back = o.items.filter((i) => i.variation_id && ['ok', 'substituted'].includes(i.status));
  await env.DB.batch([
    ...back.map((i) => env.DB.prepare('UPDATE variations SET stock = CASE WHEN stock IS NULL THEN NULL ELSE stock + ? END WHERE id = ?').bind(i.qty, i.variation_id)),
    env.DB.prepare('DELETE FROM stock_holds WHERE order_id = ?').bind(o.id),
    env.DB.prepare("UPDATE substitutions SET status = 'withdrawn' WHERE order_id = ? AND status = 'pending'").bind(o.id),
    env.DB.prepare("UPDATE orders SET status = 'canceled', updated_at = ? WHERE id = ?").bind(now, o.id),
    env.DB.prepare('INSERT INTO order_events (order_id, actor, action, detail, at) VALUES (?, ?, ?, ?, ?)').bind(o.id, me.email, 'canceled', `${reason}. Nothing was charged; ${back.length} item(s) put back in stock.`, now),
  ]);
  if (b.notify !== false) await notify(env, 'canceled', o, o.items, { reason });
  return json({ ok: true });
});
on('POST', '/admin/orders/:id/note', async ({ env, request, params }) => {
  const me = await requireStaff(env, request, 'orders'); const b = await readJson(request);
  const id = int(params.id, 1); const n = text(b.note, 1000); if (!n) fail(400, 'Write a note.');
  await event(env, id, me.email, 'note', n); return json({ ok: true });
});
on('POST', '/admin/orders/:id/refund', async ({ env, request, params }) => {
  const me = await requireStaff(env, request, 'refunds'); const b = await readJson(request);
  const o = await loadOrder(env, 'id', int(params.id, 1)); if (!o) fail(404, 'Order not found');
  const remaining = o.total_cents - o.refunded_cents;
  const amount = b.full ? remaining : dollarsToCents(b.amount);
  if (amount == null) fail(400, 'Enter a refund amount.');
  const reason = str(b.reason, 150) || 'Refund';
  await doRefund(env, o, amount, reason, me.email, (b.itemIds || []).map((x) => int(x, 1)).filter(Boolean));
  if (b.restock) {
    for (const it of o.items.filter((i) => (b.itemIds || []).map(Number).includes(i.id) || b.full)) {
      if (!it.variation_id || it.status === 'unavailable') continue;
      await env.DB.prepare('UPDATE variations SET stock = CASE WHEN stock IS NULL THEN NULL ELSE stock + ? END WHERE id = ?').bind(it.qty, it.variation_id).run();
      await pushStock(env, it.variation_id);
    }
  }
  if (b.cancel) {
    await env.DB.prepare("UPDATE orders SET status = 'canceled', updated_at = ? WHERE id = ?").bind(nowIso(), o.id).run();
    await event(env, o.id, me.email, 'canceled', reason);
    await notify(env, 'canceled', o, o.items, { reason });
  }
  return json({ ok: true });
});
on('POST', '/admin/orders/:id/items/:iid/unavailable', async ({ env, request, params }) => {
  const me = await requireStaff(env, request, 'orders');
  const o = await loadOrder(env, 'id', int(params.id, 1)); if (!o) fail(404, 'Order not found');
  const it = o.items.find((i) => i.id === int(params.iid, 1)); if (!it) fail(404, 'Item not found');
  if (it.status !== 'ok') fail(400, 'This item is already being handled.');
  await env.DB.batch([
    env.DB.prepare("UPDATE order_items SET status = 'unavailable' WHERE id = ?").bind(it.id),
    env.DB.prepare("UPDATE orders SET status = 'awaiting_approval', updated_at = ? WHERE id = ?").bind(nowIso(), o.id),
  ]);
  await event(env, o.id, me.email, 'item_unavailable', it.name);
  return json({ ok: true });
});
// candidate substitutes: same unit price, in stock
on('GET', '/admin/orders/:id/items/:iid/alternatives', async ({ env, request, params }) => {
  await requireStaff(env, request, 'orders');
  const o = await loadOrder(env, 'id', int(params.id, 1)); if (!o) fail(404, 'Order not found');
  const it = o.items.find((i) => i.id === int(params.iid, 1)); if (!it) fail(404, 'Item not found');
  const rows = (await env.DB.prepare(`SELECT v.id AS variation_id, v.name AS vname, v.price_cents, p.id AS product_id, p.name,
      (SELECT COALESCE(url, '/api/img/' || id) FROM product_images i WHERE i.product_id = p.id ORDER BY sort, id LIMIT 1) AS image_url
    FROM variations v JOIN products p ON p.id = v.product_id WHERE p.status = 'active' AND (v.price_cents = ? OR v.price_cents = ?) AND v.id != ?`).bind(it.unit_cents, it.list_cents || it.unit_cents, it.variation_id || 0).all()).results;
  const av = await availability(env, rows.map((r) => r.variation_id));
  return json({ alternatives: rows.filter((r) => (av[r.variation_id] || 0) >= it.qty).map((r) => ({ ...r, available: av[r.variation_id] })) });
});
on('POST', '/admin/orders/:id/items/:iid/substitute', async ({ env, request, params }) => {
  const me = await requireStaff(env, request, 'orders'); const b = await readJson(request);
  const o = await loadOrder(env, 'id', int(params.id, 1)); if (!o) fail(404, 'Order not found');
  const it = o.items.find((i) => i.id === int(params.iid, 1)); if (!it) fail(404, 'Item not found');
  if (!['unavailable', 'ok'].includes(it.status)) fail(400, 'This item already has an offer or was refunded.');
  const v = await env.DB.prepare(`SELECT v.id, v.price_cents, v.name AS vname, p.id AS pid, p.name, (SELECT COALESCE(url, '/api/img/' || id) FROM product_images i WHERE i.product_id = p.id ORDER BY sort, id LIMIT 1) AS image_url
    FROM variations v JOIN products p ON p.id = v.product_id WHERE v.id = ? AND p.status = 'active'`).bind(int(b.variation_id, 1) || 0).first();
  if (!v) fail(404, 'Replacement not found.');
  if (v.price_cents !== it.unit_cents && v.price_cents !== it.list_cents) fail(400, 'The replacement must be the same price.');
  const held = await placeHolds(env, o.id, [{ variation_id: v.id, qty: it.qty }], 7 * 24 * 60);
  if (held.failed.length) fail(409, 'Not enough of that replacement in stock.');
  const tok = makeToken(24), now = nowIso(), newName = v.name + (v.vname && v.vname !== 'Regular' ? ` (${v.vname})` : '');
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO substitutions (order_id, order_item_id, new_product_id, new_variation_id, new_name, new_image_url, unit_cents, token_hash, message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(o.id, it.id, v.pid, v.id, newName, v.image_url, it.unit_cents, await sha256Hex(tok), text(b.message, 500) || null, now),
    env.DB.prepare("UPDATE order_items SET status = 'awaiting_approval' WHERE id = ?").bind(it.id),
    env.DB.prepare("UPDATE orders SET status = 'awaiting_approval', updated_at = ? WHERE id = ?").bind(now, o.id),
  ]);
  const link = `${siteUrl(request, env)}/substitute.html?t=${encodeURIComponent(tok)}`;
  await event(env, o.id, me.email, 'substitution_offered', `${it.name} → ${newName}`);
  const mail = await notify(env, 'substitution_offer', o, o.items, { original: it.name, offered: newName, unit_cents: it.unit_cents, link, linkText: 'Approve or decline' });
  return json({ ok: true, link, emailStatus: mail });
});
on('POST', '/admin/substitutions/:id/withdraw', async ({ env, request, params }) => {
  const me = await requireStaff(env, request, 'orders');
  const s = await env.DB.prepare("SELECT * FROM substitutions WHERE id = ? AND status = 'pending'").bind(int(params.id, 1)).first(); if (!s) fail(404, 'Offer not found');
  await env.DB.batch([
    env.DB.prepare("UPDATE substitutions SET status = 'withdrawn', responded_at = ? WHERE id = ?").bind(nowIso(), s.id),
    env.DB.prepare("UPDATE order_items SET status = 'unavailable' WHERE id = ?").bind(s.order_item_id),
    env.DB.prepare('DELETE FROM stock_holds WHERE order_id = ? AND variation_id = ?').bind(s.order_id, s.new_variation_id),
  ]);
  await event(env, s.order_id, me.email, 'substitution_withdrawn', s.new_name);
  return json({ ok: true });
});
on('POST', '/admin/orders/:id/resend', async ({ env, request, params }) => {
  await requireStaff(env, request, 'orders'); const b = await readJson(request);
  const o = await loadOrder(env, 'id', int(params.id, 1)); if (!o) fail(404, 'Order not found');
  const kind = ['customer_confirmation', 'ready_for_pickup', 'shipped', 'delivery_update'].includes(b.kind) ? b.kind : 'customer_confirmation';
  return json({ status: await notify(env, kind, o, o.items, { link: await customerLink(env, siteUrl(request, env), o.code) }) });
});

// ======================================================================
// ADMIN — catalog
// ======================================================================
async function productFull(env, id) {
  const p = await env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(id).first(); if (!p) return null;
  p.variations = (await env.DB.prepare('SELECT * FROM variations WHERE product_id = ? ORDER BY sort, id').bind(id).all()).results;
  p.images = (await env.DB.prepare('SELECT id, url, sort, square_image_id FROM product_images WHERE product_id = ? ORDER BY sort, id').bind(id).all()).results.map((i) => ({ ...i, src: imgUrl(i) }));
  return p;
}
on('GET', '/admin/products', async ({ env, request }) => {
  await requireStaff(env, request, 'products');
  const prods = (await env.DB.prepare(`SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.status != 'deleted' ORDER BY p.sort, p.id`).all()).results;
  const vars = (await env.DB.prepare(`SELECT v.* FROM variations v JOIN products p ON p.id = v.product_id WHERE p.status != 'deleted' ORDER BY v.sort, v.id`).all()).results;
  const imgs = (await env.DB.prepare(`SELECT id, product_id, url FROM product_images ORDER BY sort, id`).all()).results;
  const av = await availability(env, vars.map((v) => v.id));
  return json({ products: prods.map((p) => ({ ...p, variations: vars.filter((v) => v.product_id === p.id).map((v) => ({ ...v, available: av[v.id] })),
    image: (imgs.find((i) => i.product_id === p.id) && imgUrl(imgs.find((i) => i.product_id === p.id))) || null })) });
});
on('GET', '/admin/products/:id', async ({ env, request, params }) => {
  await requireStaff(env, request, 'products');
  const p = await productFull(env, int(params.id, 1)); if (!p) fail(404, 'Product not found');
  return json({ product: p });
});

function readProduct(b) {
  const name = str(b.name, 120); if (name.length < 2) fail(400, 'Enter a product name.');
  const vars = Array.isArray(b.variations) && b.variations.length ? b.variations : fail(400, 'Add at least one price.');
  if (vars.length > 30) fail(400, 'Too many variations.');
  return {
    name, description: text(b.description, 3000), category_id: int(b.category_id, 1) || null, featured: b.featured ? 1 : 0,
    status: ['active', 'hidden'].includes(b.status) ? b.status : 'active', sort: int(b.sort, 0, 100000) ?? 0,
    variations: vars.map((v, i) => {
      const price = dollarsToCents(v.price); if (price == null) fail(400, `Enter a valid price for "${v.name || 'Regular'}".`);
      const stock = v.stock === '' || v.stock == null ? null : int(v.stock, 0, 100000);
      if (v.stock !== '' && v.stock != null && stock == null) fail(400, 'Quantity must be a whole number.');
      return { id: int(v.id, 1) || null, name: str(v.name, 60) || 'Regular', sku: str(v.sku, 40) || null, price_cents: price, stock, sort: i };
    }),
  };
}
async function uniqueSlug(env, name, exceptId) {
  const base = slugify(name); let s = base, n = 1;
  while (await env.DB.prepare('SELECT id FROM products WHERE slug = ? AND id != ?').bind(s, exceptId || 0).first()) s = `${base}-${++n}`;
  return s;
}
on('POST', '/admin/products', async ({ env, request }) => {
  const me = await requireStaff(env, request, 'products'); const d = readProduct(await readJson(request)); const now = nowIso();
  const p = await env.DB.prepare(`INSERT INTO products (slug, name, description, category_id, featured, status, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`)
    .bind(await uniqueSlug(env, d.name), d.name, d.description, d.category_id, d.featured, d.status, d.sort, now, now).first();
  await env.DB.batch(d.variations.map((v) => env.DB.prepare('INSERT INTO variations (product_id, name, sku, price_cents, stock, sort) VALUES (?, ?, ?, ?, ?, ?)').bind(p.id, v.name, v.sku, v.price_cents, v.stock, v.sort)));
  await log(env, 'info', 'Product created', { id: p.id, by: me.email });
  const sync = await syncProduct(env, p.id);
  return json({ id: p.id, sync });
});
on('PUT', '/admin/products/:id', async ({ env, request, params }) => {
  const me = await requireStaff(env, request, 'products'); const id = int(params.id, 1); const b = await readJson(request); const d = readProduct(b);
  const cur = await productFull(env, id); if (!cur) fail(404, 'Product not found');
  const now = nowIso(); const stmts = [];
  stmts.push(env.DB.prepare(`UPDATE products SET name = ?, slug = ?, description = ?, category_id = ?, featured = ?, status = ?, sort = ?, price_confirmed = 1, updated_at = ? WHERE id = ?`)
    .bind(d.name, cur.name === d.name ? cur.slug : await uniqueSlug(env, d.name, id), d.description, d.category_id, d.featured, d.status, d.sort, now, id));
  const keep = d.variations.filter((v) => v.id && cur.variations.some((x) => x.id === v.id)).map((v) => v.id);
  const removed = cur.variations.filter((x) => !keep.includes(x.id));
  for (const v of d.variations) {
    if (v.id && keep.includes(v.id)) stmts.push(env.DB.prepare('UPDATE variations SET name = ?, sku = ?, price_cents = ?, stock = ?, sort = ? WHERE id = ? AND product_id = ?').bind(v.name, v.sku, v.price_cents, v.stock, v.sort, v.id, id));
    else stmts.push(env.DB.prepare('INSERT INTO variations (product_id, name, sku, price_cents, stock, sort) VALUES (?, ?, ?, ?, ?, ?)').bind(id, v.name, v.sku, v.price_cents, v.stock, v.sort));
  }
  for (const r of removed) stmts.push(env.DB.prepare('DELETE FROM variations WHERE id = ?').bind(r.id));
  await env.DB.batch(stmts);
  if (await sq.isConnected(env)) for (const r of removed) if (r.square_variation_id) { try { await sq.deleteCatalogObject(env, r.square_variation_id); } catch (e) { /* reported by sync */ } }
  await log(env, 'info', 'Product updated', { id, by: me.email });
  return json({ ok: true, sync: await syncProduct(env, id) });
});
on('DELETE', '/admin/products/:id', async ({ env, request, params }) => {
  const me = await requireStaff(env, request, 'products'); const id = int(params.id, 1);
  const p = await productFull(env, id); if (!p) fail(404, 'Product not found');
  await env.DB.batch([
    env.DB.prepare("UPDATE products SET status = 'deleted', slug = slug || '-deleted-' || id, updated_at = ? WHERE id = ?").bind(nowIso(), id),
    env.DB.prepare('DELETE FROM product_images WHERE product_id = ?').bind(id),
  ]);
  let note = null;
  if (p.square_item_id && await sq.isConnected(env)) { try { await sq.deleteCatalogObject(env, p.square_item_id); } catch (e) { note = 'Removed from the site, but Square said: ' + e.message; } }
  await log(env, 'info', 'Product deleted', { id, by: me.email });
  return json({ ok: true, note });
});

// images: multipart field "photo" (one or more files), already resized in the browser
on('POST', '/admin/products/:id/images', async ({ env, request, params }) => {
  await requireStaff(env, request, 'products'); const id = int(params.id, 1);
  const p = await env.DB.prepare('SELECT id, square_item_id FROM products WHERE id = ?').bind(id).first(); if (!p) fail(404, 'Product not found');
  const fd = await request.formData(); const files = fd.getAll('photo').filter((f) => f && typeof f === 'object');
  if (!files.length) fail(400, 'No photo received.');
  const max = await env.DB.prepare('SELECT COALESCE(MAX(sort), -1) AS m FROM product_images WHERE product_id = ?').bind(id).first();
  const out = []; let sort = max.m;
  for (const f of files.slice(0, 10)) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type)) fail(400, 'Photos must be JPG, PNG or WebP.');
    if (f.size > 1.8 * 1024 * 1024) fail(413, 'Photo is too large after resizing (max 1.8 MB).');
    const bytes = new Uint8Array(await f.arrayBuffer());
    const r = await env.DB.prepare('INSERT INTO product_images (product_id, data, mime, sort, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id').bind(id, bytes, f.type, ++sort, nowIso()).first();
    out.push(r.id);
    if (p.square_item_id && await sq.isConnected(env)) {
      try { const sid = await sq.uploadImage(env, p.square_item_id, bytes, f.type, 'photo-' + r.id, sort === 0); await env.DB.prepare('UPDATE product_images SET square_image_id = ? WHERE id = ?').bind(sid, r.id).run(); }
      catch (e) { await log(env, 'warn', 'Square image upload failed', { e: e.message }); }
    }
  }
  await env.DB.prepare('UPDATE products SET updated_at = ? WHERE id = ?').bind(nowIso(), id).run();
  return json({ ids: out });
});
on('DELETE', '/admin/images/:id', async ({ env, request, params }) => {
  await requireStaff(env, request, 'products');
  const img = await env.DB.prepare('SELECT * FROM product_images WHERE id = ?').bind(int(params.id, 1)).first(); if (!img) fail(404, 'Photo not found');
  await env.DB.prepare('DELETE FROM product_images WHERE id = ?').bind(img.id).run();
  if (img.square_image_id && await sq.isConnected(env)) { try { await sq.deleteCatalogObject(env, img.square_image_id); } catch { /* ignore */ } }
  return json({ ok: true });
});
on('POST', '/admin/products/:id/images/order', async ({ env, request, params }) => {
  await requireStaff(env, request, 'products'); const b = await readJson(request); const id = int(params.id, 1);
  const ids = (b.ids || []).map((x) => int(x, 1)).filter(Boolean);
  await env.DB.batch(ids.map((imgId, i) => env.DB.prepare('UPDATE product_images SET sort = ? WHERE id = ? AND product_id = ?').bind(i, imgId, id)));
  await env.DB.prepare('UPDATE products SET updated_at = ? WHERE id = ?').bind(nowIso(), id).run();
  return json({ ok: true });
});

// quantities
async function pushStock(env, variationId) {
  const v = await env.DB.prepare('SELECT stock, square_variation_id FROM variations WHERE id = ?').bind(variationId).first();
  if (v?.square_variation_id && v.stock != null && await sq.isConnected(env)) {
    try { await sq.setCount(env, v.square_variation_id, Math.max(0, v.stock)); return null; } catch (e) { return e.message; }
  }
  return null;
}
on('POST', '/admin/stock', async ({ env, request }) => {
  const me = await requireStaff(env, request, 'stock'); const b = await readJson(request);
  const changes = Array.isArray(b.changes) ? b.changes.slice(0, 200) : [];
  const errors = [];
  for (const c of changes) {
    const id = int(c.variation_id, 1); const stock = c.stock === '' || c.stock == null ? null : int(c.stock, 0, 100000);
    if (!id || (c.stock !== '' && c.stock != null && stock == null)) { errors.push(`Invalid quantity for item ${c.variation_id}`); continue; }
    await env.DB.prepare('UPDATE variations SET stock = ? WHERE id = ?').bind(stock, id).run();
    const err = await pushStock(env, id); if (err) errors.push(err);
  }
  await log(env, 'info', 'Stock updated', { n: changes.length, by: me.email });
  return json({ ok: true, squareErrors: errors });
});

// categories
on('GET', '/admin/categories', async ({ env, request }) => {
  await requireStaff(env, request, 'products');
  return json({ categories: (await env.DB.prepare(`SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.status != 'deleted') AS products FROM categories c ORDER BY sort, name`).all()).results });
});
on('POST', '/admin/categories', async ({ env, request }) => {
  await requireStaff(env, request, 'products'); const b = await readJson(request); const name = str(b.name, 60); if (name.length < 2) fail(400, 'Enter a category name.');
  let slug = slugify(name), n = 1; while (await env.DB.prepare('SELECT id FROM categories WHERE slug = ?').bind(slug).first()) slug = slugify(name) + '-' + (++n);
  const m = await env.DB.prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM categories').first();
  await env.DB.prepare('INSERT INTO categories (name, slug, sort) VALUES (?, ?, ?)').bind(name, slug, m.m + 1).run();
  return json({ ok: true });
});
on('PUT', '/admin/categories/:id', async ({ env, request, params }) => {
  await requireStaff(env, request, 'products'); const b = await readJson(request); const id = int(params.id, 1);
  const name = str(b.name, 60); if (name.length < 2) fail(400, 'Enter a category name.');
  await env.DB.prepare('UPDATE categories SET name = ?, visible = ?, sort = ? WHERE id = ?').bind(name, b.visible ? 1 : 0, int(b.sort, 0, 10000) ?? 0, id).run();
  return json({ ok: true });
});
on('DELETE', '/admin/categories/:id', async ({ env, request, params }) => {
  await requireStaff(env, request, 'products'); const id = int(params.id, 1);
  await env.DB.batch([env.DB.prepare('UPDATE products SET category_id = NULL WHERE category_id = ?').bind(id), env.DB.prepare('DELETE FROM categories WHERE id = ?').bind(id)]);
  return json({ ok: true });
});

// ======================================================================
// ADMIN — settings & Square
// ======================================================================
const EDITABLE = ['shipping_enabled', 'pickup_enabled', 'shipping_mode', 'shipping_flat_cents', 'shipping_free_over_cents', 'shipping_tiers', 'shipping_note', 'pickup_instructions', 'store_email', 'store_phone', 'hold_minutes',
  'pay_in_store_enabled', 'pickup_ready_text', 'shipping_time_text', 'delivery_days', 'pickup_hold_days', 'site_announcement', 'marquee_items', 'store_address', 'store_hours',
  'sale_enabled', 'sale_percent', 'sale_category_id', 'sale_label', 'sale_ends'];
on('GET', '/admin/settings', async ({ env, request }) => {
  await requireStaff(env, request, 'settings');
  const s = await getSettings(env);
  const cats = (await env.DB.prepare('SELECT id, name FROM categories ORDER BY sort, name').all()).results;
  return json({ settings: Object.fromEntries(EDITABLE.map((k) => [k, s[k] ?? ''])), categories: cats, saleActive: saleInfo(s),
    square: { appConfigured: sq.appConfigured(env), connected: await sq.isConnected(env), env: sq.squareEnv(env), locationId: s.sq_location_id || null, locationName: s.sq_location_name || null,
      locations: s.sq_locations ? JSON.parse(s.sq_locations) : [], connectedAt: s.sq_connected_at || null, webhookSecretSet: !!env.SQUARE_WEBHOOK_SIGNATURE_KEY, webhookUrl: `${siteUrl(request, env)}/api/square/webhook` },
    email: { configured: !!(env.RESEND_API_KEY && env.EMAIL_FROM), from: env.EMAIL_FROM || null } });
});
on('PUT', '/admin/settings', async ({ env, request }) => {
  await requireStaff(env, request, 'settings'); const b = await readJson(request);
  for (const k of EDITABLE) {
    if (!(k in b)) continue; let v = b[k];
    if (k.endsWith('_enabled')) v = v ? '1' : '0';
    else if (k === 'shipping_mode') v = v === 'tiers' ? 'tiers' : 'flat';
    else if (k === 'shipping_flat_cents' || k === 'shipping_free_over_cents') { v = v === '' || v == null ? '' : dollarsToCents(v); if (v === null) fail(400, 'Shipping amounts must be dollar values.'); }
    else if (k === 'shipping_tiers') { const t = (Array.isArray(v) ? v : []).map((x) => ({ min_cents: dollarsToCents(x.min), rate_cents: dollarsToCents(x.rate) })); if (t.some((x) => x.min_cents == null || x.rate_cents == null)) fail(400, 'Every shipping tier needs a minimum and a rate.'); v = JSON.stringify(t); }
    else if (k === 'store_email') { v = str(v, 120); if (v && !isEmail(v)) fail(400, 'Store email is not valid.'); }
    else if (k === 'hold_minutes') v = String(int(v, 5, 30) || 10);
    else if (k === 'pickup_hold_days') v = String(int(v, 1, 30) || 3);
    else if (k === 'marquee_items') { const a = (Array.isArray(v) ? v : String(v || '').split('\n')).map((x) => str(x, 60)).filter(Boolean).slice(0, 20); v = JSON.stringify(a); }
    else if (k === 'store_hours') { const a = (Array.isArray(v) ? v : []).map((r) => [str(r?.[0], 40), str(r?.[1], 40)]).filter((r) => r[0] && r[1]).slice(0, 10); v = JSON.stringify(a); }
    else if (k === 'sale_percent') { v = v === '' || v == null ? '' : int(v, 1, 90); if (v === null) fail(400, 'Sale percent must be a whole number from 1 to 90.'); v = String(v); }
    else if (k === 'sale_category_id') { v = v ? String(int(v, 1) || '') : ''; if (v && !(await env.DB.prepare('SELECT id FROM categories WHERE id = ?').bind(Number(v)).first())) fail(400, 'Pick a valid category for the sale.'); }
    else if (k === 'sale_ends') { v = str(v, 10); if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) fail(400, 'Sale end date must be a date.'); }
    else if (k === 'site_announcement' || k === 'sale_label') v = str(v, 140);
    else if (k === 'pickup_ready_text' || k === 'shipping_time_text') v = str(v, 160);
    else if (k === 'delivery_days') { const n = int(v); if (n == null || n < 1 || n > 30) fail(400, 'Usual delivery time must be 1–30 business days.'); v = String(n); }
    else v = text(v, 1000);
    await setSetting(env, k, v);
  }
  const S = await getSettings(env);
  if (S.sale_enabled === '1' && !(Number(S.sale_percent) >= 1)) { await setSetting(env, 'sale_enabled', '0'); fail(400, 'Enter the sale percent (1–90) before turning the sale on.'); }
  return json({ ok: true, sale: saleInfo(S) });
});
on('POST', '/admin/square/location', async ({ env, request }) => {
  await requireStaff(env, request, 'settings'); const b = await readJson(request);
  const s = await getSettings(env); const locs = s.sq_locations ? JSON.parse(s.sq_locations) : [];
  const l = locs.find((x) => x.id === b.locationId); if (!l) fail(400, 'Unknown location');
  await setSetting(env, 'sq_location_id', l.id); await setSetting(env, 'sq_location_name', l.name || '');
  return json({ ok: true });
});
on('GET', '/admin/square/connect', async ({ env, request }) => {
  await requireStaff(env, request, 'settings');
  return json({ url: await sq.authorizeUrl(env, `${siteUrl(request, env)}/api/square/callback`) });
});
on('POST', '/admin/square/disconnect', async ({ env, request }) => {
  const me = await requireStaff(env, request, 'settings'); await sq.disconnect(env);
  await log(env, 'info', 'Square disconnected', { by: me.email }); return json({ ok: true });
});

// push one product to Square (create/update item + variations + stock + images)
async function syncProduct(env, id) {
  if (!(await sq.isConnected(env))) return { skipped: 'Square not connected' };
  const p = await productFull(env, id); if (!p || p.status === 'deleted') return { skipped: 'deleted' };
  try {
    let catSq = null;
    if (p.category_id) {
      const cat = await env.DB.prepare('SELECT * FROM categories WHERE id = ?').bind(p.category_id).first();
      if (cat) { catSq = await sq.ensureCategory(env, cat); if (catSq && !cat.square_id) await env.DB.prepare('UPDATE categories SET square_id = ? WHERE id = ?').bind(catSq, cat.id).run(); }
    }
    const r = await sq.pushProduct(env, p, p.variations, catSq);
    const stmts = [env.DB.prepare('UPDATE products SET square_item_id = ?, square_synced_at = ? WHERE id = ?').bind(r.itemId, nowIso(), id)];
    for (const v of p.variations) if (r.variationIds[v.id]) stmts.push(env.DB.prepare('UPDATE variations SET square_variation_id = ? WHERE id = ?').bind(r.variationIds[v.id], v.id));
    await env.DB.batch(stmts);
    for (const v of p.variations) if (v.stock != null && r.variationIds[v.id]) await sq.setCount(env, r.variationIds[v.id], Math.max(0, v.stock));
    // images not yet in Square
    for (const [i, img] of p.images.entries()) {
      if (img.square_image_id) continue;
      let bytes, mime;
      if (img.url) { continue; } // seeded site photos are already public; only owner uploads are pushed
      const row = await env.DB.prepare('SELECT data, mime FROM product_images WHERE id = ?').bind(img.id).first();
      bytes = new Uint8Array(row.data); mime = row.mime;
      const sid = await sq.uploadImage(env, r.itemId, bytes, mime, 'photo-' + img.id, i === 0);
      await env.DB.prepare('UPDATE product_images SET square_image_id = ? WHERE id = ?').bind(sid, img.id).run();
    }
    return { ok: true };
  } catch (e) {
    await log(env, 'error', 'Square product sync failed', { id, e: e.message });
    return { error: 'Saved on the website, but Square sync failed: ' + e.message };
  }
}
on('POST', '/admin/products/:id/sync', async ({ env, request, params }) => { await requireStaff(env, request, 'products'); return json(await syncProduct(env, int(params.id, 1))); });

// Push all products to Square in batches (client calls repeatedly until remaining = 0)
on('POST', '/admin/square/push', async ({ env, request }) => {
  await requireStaff(env, request, 'settings');
  if (!(await sq.isConnected(env))) fail(409, 'Connect Square first.');
  const rows = (await env.DB.prepare("SELECT id FROM products WHERE status != 'deleted' AND (square_synced_at IS NULL OR square_synced_at < updated_at) ORDER BY id LIMIT 6").all()).results;
  const errors = [];
  for (const r of rows) { const res = await syncProduct(env, r.id); if (res.error) errors.push(res.error); }
  const left = await env.DB.prepare("SELECT COUNT(*) AS n FROM products WHERE status != 'deleted' AND (square_synced_at IS NULL OR square_synced_at < updated_at)").first();
  return json({ done: rows.length, remaining: errors.length ? 0 : left.n, errors });
});
// Pull Square stock counts for every linked variation
on('POST', '/admin/square/pull-stock', async ({ env, request }) => {
  await requireStaff(env, request, 'stock');
  if (!(await sq.isConnected(env))) fail(409, 'Connect Square first.');
  const vars = (await env.DB.prepare('SELECT id, square_variation_id FROM variations WHERE square_variation_id IS NOT NULL').all()).results;
  const counts = await sq.getCounts(env, vars.map((v) => v.square_variation_id));
  if (vars.length) await env.DB.batch(vars.map((v) => env.DB.prepare('UPDATE variations SET stock = ? WHERE id = ?').bind(counts[v.square_variation_id] ?? 0, v.id)));
  const prices = await pullLinkedCatalog(env);
  return json({ ok: true, updated: vars.length, products: prices });
});
// Import items that exist in Square but not on the website
on('POST', '/admin/square/import', async ({ env, request }) => {
  const me = await requireStaff(env, request, 'settings');
  if (!(await sq.isConnected(env))) fail(409, 'Connect Square first.');
  const [items, images, cats] = await Promise.all([sq.listCatalog(env, 'ITEM'), sq.listCatalog(env, 'IMAGE'), sq.listCatalog(env, 'CATEGORY')]);
  const imgUrlById = Object.fromEntries(images.map((i) => [i.id, i.image_data?.url]));
  const linked = new Set((await env.DB.prepare('SELECT square_item_id FROM products WHERE square_item_id IS NOT NULL').all()).results.map((r) => r.square_item_id));
  const catMap = {};
  for (const c of cats) {
    let row = await env.DB.prepare('SELECT id FROM categories WHERE square_id = ?').bind(c.id).first();
    if (!row) { const nm = c.category_data?.name || 'Category'; let slug = slugify(nm), n = 1; while (await env.DB.prepare('SELECT id FROM categories WHERE slug = ?').bind(slug).first()) slug = slugify(nm) + '-' + (++n);
      row = await env.DB.prepare('INSERT INTO categories (name, slug, sort, square_id) VALUES (?, ?, 99, ?) RETURNING id').bind(nm, slug, c.id).first(); }
    catMap[c.id] = row.id;
  }
  let created = 0; const now = nowIso();
  for (const it of items) {
    if (linked.has(it.id) || it.is_deleted) continue;
    const d = it.item_data || {}; const vars = (d.variations || []).filter((v) => v.item_variation_data?.price_money);
    if (!vars.length) continue;
    const catId = catMap[d.categories?.[0]?.id || d.category_id] || null;
    const p = await env.DB.prepare(`INSERT INTO products (slug, name, description, category_id, status, square_item_id, square_synced_at, created_at, updated_at) VALUES (?, ?, ?, ?, 'hidden', ?, ?, ?, ?) RETURNING id`)
      .bind(await uniqueSlug(env, d.name || 'item'), d.name || 'Item', d.description || '', catId, it.id, now, now, now).first();
    const stmts = vars.map((v, i) => env.DB.prepare('INSERT INTO variations (product_id, name, sku, price_cents, sort, square_variation_id) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(p.id, v.item_variation_data.name || 'Regular', v.item_variation_data.sku || null, v.item_variation_data.price_money.amount, i, v.id));
    (d.image_ids || []).forEach((iid, i) => { if (imgUrlById[iid]) stmts.push(env.DB.prepare('INSERT INTO product_images (product_id, url, sort, square_image_id, created_at) VALUES (?, ?, ?, ?, ?)').bind(p.id, imgUrlById[iid], i, iid, now)); });
    await env.DB.batch(stmts); created++;
  }
  await log(env, 'info', 'Imported from Square', { created, by: me.email });
  return json({ ok: true, created, note: created ? 'Imported items are hidden until you review them and press Show on site.' : 'Nothing new to import.' });
});

// ---------- logs / outbox ----------
on('GET', '/admin/outbox', async ({ env, request }) => {
  await requireStaff(env, request, 'orders');
  return json({ emails: (await env.DB.prepare('SELECT id, to_email, subject, status, error, order_id, created_at FROM outbox ORDER BY id DESC LIMIT 100').all()).results });
});
on('GET', '/admin/outbox/:id', async ({ env, request, params }) => {
  await requireStaff(env, request, 'orders');
  return json({ email: await env.DB.prepare('SELECT * FROM outbox WHERE id = ?').bind(int(params.id, 1)).first() });
});
on('GET', '/admin/log', async ({ env, request }) => {
  await requireStaff(env, request, 'staff');
  return json({ log: (await env.DB.prepare('SELECT * FROM app_log ORDER BY id DESC LIMIT 200').all()).results });
});
