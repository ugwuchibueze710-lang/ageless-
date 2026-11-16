// Square integration: OAuth connection, catalog/inventory sync, orders, payments, refunds, webhooks.
// Credentials live only in Cloudflare secrets (SQUARE_APP_ID, SQUARE_APP_SECRET, SQUARE_ENV,
// SQUARE_WEBHOOK_SIGNATURE_KEY) and the encrypted per-merchant tokens in settings.
import { fail, nowIso, token, timingSafeEqual, log } from './util.js';
import { getSettings, setSetting } from './db.js';
import { encrypt, decrypt } from './crypto.js';

const VERSION = '2025-10-16';
export const SCOPES = ['MERCHANT_PROFILE_READ', 'ITEMS_READ', 'ITEMS_WRITE', 'INVENTORY_READ', 'INVENTORY_WRITE',
  'ORDERS_READ', 'ORDERS_WRITE', 'PAYMENTS_READ', 'PAYMENTS_WRITE'];

export function squareEnv(env) { return env.SQUARE_ENV === 'production' ? 'production' : 'sandbox'; }
export function base(env) { return squareEnv(env) === 'production' ? 'https://connect.squareup.com' : 'https://connect.squareupsandbox.com'; }
export function appConfigured(env) { return !!(env.SQUARE_APP_ID && env.SQUARE_APP_SECRET && env.TOKEN_KEY); }

// ---------- connection state ----------
export async function connection(env) {
  const s = await getSettings(env);
  if (!s.sq_access) return null;
  return { merchantId: s.sq_merchant_id, locationId: s.sq_location_id, locationName: s.sq_location_name,
    expiresAt: s.sq_expires_at, connectedAt: s.sq_connected_at, env: s.sq_env, enc: { access: s.sq_access, refresh: s.sq_refresh } };
}
export async function isConnected(env) {
  const c = await connection(env);
  return !!(c && c.locationId && c.env === squareEnv(env) && appConfigured(env));
}

export async function authorizeUrl(env, redirectUri) {
  if (!appConfigured(env)) fail(400, 'Square app credentials are not set on the server yet.');
  const state = token(18);
  await setSetting(env, 'sq_oauth_state', state + '|' + (Date.now() + 15 * 60e3));
  const u = new URL(base(env) + '/oauth2/authorize');
  u.searchParams.set('client_id', env.SQUARE_APP_ID);
  u.searchParams.set('scope', SCOPES.join(' '));
  u.searchParams.set('session', 'false');
  u.searchParams.set('state', state);
  if (redirectUri) u.searchParams.set('redirect_uri', redirectUri);
  return u.toString();
}

export async function completeOAuth(env, codeParam, state, redirectUri) {
  const s = await getSettings(env);
  const [want, exp] = String(s.sq_oauth_state || '').split('|');
  if (!want || !state || !timingSafeEqual(want, state) || Date.now() > Number(exp)) fail(400, 'Square connection link expired. Please click Connect Square again.');
  await setSetting(env, 'sq_oauth_state', '');
  const body = { client_id: env.SQUARE_APP_ID, client_secret: env.SQUARE_APP_SECRET, code: codeParam, grant_type: 'authorization_code' };
  if (redirectUri) body.redirect_uri = redirectUri;
  const r = await fetch(base(env) + '/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Square-Version': VERSION }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) { await log(env, 'error', 'Square OAuth token exchange failed', j); fail(502, 'Square did not accept the connection. Please try again.'); }
  await storeTokens(env, j);
  // pick the store location
  const locs = await api(env, 'GET', '/v2/locations');
  const active = (locs.locations || []).filter((l) => l.status === 'ACTIVE');
  if (!active.length) fail(400, 'No active Square location found on this account.');
  const chosen = active.find((l) => l.id === s.sq_location_id) || active[0];
  await setSetting(env, 'sq_location_id', chosen.id);
  await setSetting(env, 'sq_location_name', chosen.name || '');
  await setSetting(env, 'sq_locations', JSON.stringify(active.map((l) => ({ id: l.id, name: l.name }))));
  await setSetting(env, 'sq_connected_at', nowIso());
  await setSetting(env, 'sq_env', squareEnv(env));
  await log(env, 'info', 'Square connected', { merchant: j.merchant_id, location: chosen.id, env: squareEnv(env) });
}

async function storeTokens(env, j) {
  await setSetting(env, 'sq_access', await encrypt(env, j.access_token));
  if (j.refresh_token) await setSetting(env, 'sq_refresh', await encrypt(env, j.refresh_token));
  await setSetting(env, 'sq_expires_at', j.expires_at || '');
  if (j.merchant_id) await setSetting(env, 'sq_merchant_id', j.merchant_id);
}

export async function disconnect(env) {
  const c = await connection(env);
  if (c && appConfigured(env)) {
    try {
      await fetch(base(env) + '/oauth2/revoke', { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Square-Version': VERSION, Authorization: 'Client ' + env.SQUARE_APP_SECRET },
        body: JSON.stringify({ client_id: env.SQUARE_APP_ID, access_token: await decrypt(env, c.enc.access) }) });
    } catch (e) { await log(env, 'warn', 'Square revoke failed', { e: String(e) }); }
  }
  for (const k of ['sq_access', 'sq_refresh', 'sq_expires_at', 'sq_merchant_id', 'sq_location_id', 'sq_location_name', 'sq_locations', 'sq_connected_at', 'sq_env']) await setSetting(env, k, '');
}

async function accessToken(env) {
  const c = await connection(env);
  if (!c || !c.enc.access) fail(409, 'Square is not connected.');
  const soon = c.expiresAt ? Date.parse(c.expiresAt) - Date.now() < 3 * 24 * 3600e3 : false;
  if (soon && c.enc.refresh) {
    const r = await fetch(base(env) + '/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Square-Version': VERSION },
      body: JSON.stringify({ client_id: env.SQUARE_APP_ID, client_secret: env.SQUARE_APP_SECRET, grant_type: 'refresh_token', refresh_token: await decrypt(env, c.enc.refresh) }) });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.access_token) { await storeTokens(env, j); return j.access_token; }
    await log(env, 'error', 'Square token refresh failed', j);
  }
  return decrypt(env, c.enc.access);
}

// Generic API call. Throws HttpError with Square's message on failure.
export async function api(env, method, path, body, extraHeaders) {
  const t = await accessToken(env);
  const r = await fetch(base(env) + path, {
    method, headers: { Authorization: 'Bearer ' + t, 'Square-Version': VERSION, ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...(extraHeaders || {}) },
    body: body ? (body instanceof FormData ? body : JSON.stringify(body)) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = (j.errors || []).map((e) => e.detail || e.code).join('; ') || ('Square error ' + r.status);
    await log(env, 'error', `Square ${method} ${path} failed`, j.errors || j);
    const err = new Error(msg); err.status = r.status; err.square = j.errors || []; throw err;
  }
  return j;
}

// ---------- catalog ----------
// Push one product (+ its variations) to the Square catalog. Returns { itemId, variationIds: {localId: squareId} }.
export async function pushProduct(env, product, variations, categorySquareId) {
  let existing = null;
  if (product.square_item_id) {
    try { existing = (await api(env, 'GET', `/v2/catalog/object/${product.square_item_id}`)).object; } catch (e) { if (e.status !== 404) throw e; }
  }
  const exVars = Object.fromEntries(((existing?.item_data?.variations) || []).map((v) => [v.id, v]));
  const obj = {
    type: 'ITEM', id: existing ? existing.id : '#item' + product.id, version: existing?.version,
    present_at_all_locations: true,
    item_data: {
      name: product.name, description: product.description || undefined, product_type: 'REGULAR',
      categories: categorySquareId ? [{ id: categorySquareId }] : undefined,
      image_ids: existing?.item_data?.image_ids,
      variations: variations.map((v) => {
        const ex = v.square_variation_id && exVars[v.square_variation_id];
        return { type: 'ITEM_VARIATION', id: ex ? ex.id : '#var' + v.id, version: ex?.version, present_at_all_locations: true,
          item_variation_data: { name: v.name || 'Regular', sku: v.sku || undefined, pricing_type: 'FIXED_PRICING',
            price_money: { amount: v.price_cents, currency: 'USD' }, track_inventory: true } };
      }),
    },
  };
  const r = await api(env, 'POST', '/v2/catalog/object', { idempotency_key: crypto.randomUUID(), object: obj });
  const map = Object.fromEntries((r.id_mappings || []).map((m) => [m.client_object_id, m.object_id]));
  const itemId = existing ? existing.id : map['#item' + product.id] || r.catalog_object?.id;
  const variationIds = {};
  for (const v of variations) variationIds[v.id] = (v.square_variation_id && exVars[v.square_variation_id]) ? v.square_variation_id : map['#var' + v.id];
  return { itemId, variationIds };
}

export async function deleteCatalogObject(env, id) {
  try { await api(env, 'DELETE', `/v2/catalog/object/${id}`); } catch (e) { if (e.status !== 404) throw e; }
}

export async function ensureCategory(env, cat) {
  if (cat.square_id) return cat.square_id;
  const r = await api(env, 'POST', '/v2/catalog/object', { idempotency_key: crypto.randomUUID(),
    object: { type: 'CATEGORY', id: '#cat' + cat.id, category_data: { name: cat.name } } });
  return r.catalog_object?.id;
}

// Upload one image to an item. bytes: Uint8Array, mime: image/jpeg|png|webp
export async function uploadImage(env, itemId, bytes, mime, name, primary) {
  const fd = new FormData();
  fd.append('request', new Blob([JSON.stringify({ idempotency_key: crypto.randomUUID(), object_id: itemId, is_primary: !!primary,
    image: { type: 'IMAGE', id: '#img', image_data: { name: name || 'photo' } } })], { type: 'application/json' }));
  fd.append('image_file', new Blob([bytes], { type: mime }), 'photo.' + (mime.split('/')[1] || 'jpg'));
  const r = await api(env, 'POST', '/v2/catalog/images', fd);
  return r.image?.id;
}

export async function listCatalog(env, types) {
  const out = []; let cursor;
  do {
    const r = await api(env, 'GET', `/v2/catalog/list?types=${types}${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`);
    out.push(...(r.objects || [])); cursor = r.cursor;
  } while (cursor && out.length < 5000);
  return out;
}

// ---------- inventory ----------
export async function getCounts(env, variationIds) {
  const c = await connection(env); const counts = {};
  for (let i = 0; i < variationIds.length; i += 100) {
    const ids = variationIds.slice(i, i + 100);
    let cursor;
    do {
      const r = await api(env, 'POST', '/v2/inventory/counts/batch-retrieve', { catalog_object_ids: ids, location_ids: [c.locationId], states: ['IN_STOCK'], cursor });
      for (const x of r.counts || []) counts[x.catalog_object_id] = Math.floor(Number(x.quantity));
      cursor = r.cursor;
    } while (cursor);
    for (const id of ids) if (!(id in counts)) counts[id] = 0;
  }
  return counts;
}
export async function setCount(env, variationId, qty) {
  const c = await connection(env);
  await api(env, 'POST', '/v2/inventory/changes/batch-create', { idempotency_key: crypto.randomUUID(), changes: [{
    type: 'PHYSICAL_COUNT', physical_count: { catalog_object_id: variationId, state: 'IN_STOCK', location_id: c.locationId, quantity: String(qty), occurred_at: nowIso() } }] });
}
export async function adjustSold(env, variationId, qty) {
  const c = await connection(env);
  await api(env, 'POST', '/v2/inventory/changes/batch-create', { idempotency_key: crypto.randomUUID(), changes: [{
    type: 'ADJUSTMENT', adjustment: { catalog_object_id: variationId, from_state: 'IN_STOCK', to_state: 'SOLD', location_id: c.locationId, quantity: String(qty), occurred_at: nowIso() } }] });
}

// ---------- orders & payments ----------
function lineItems(items) {
  return items.map((it) => it.square_variation_id
    ? { catalog_object_id: it.square_variation_id, quantity: String(it.qty) }
    : { name: it.name + (it.variation_name && it.variation_name !== 'Regular' ? ` (${it.variation_name})` : ''), quantity: String(it.qty), base_price_money: { amount: it.unit_cents, currency: 'USD' } });
}
function orderBody(c, o, items, shippingCents) {
  const order = { location_id: c.locationId, reference_id: o.code, line_items: lineItems(items) };
  // sale price: catalog items keep their catalog link and get a fixed per-line discount, so Square charges exactly what the site showed
  const disc = [];
  items.forEach((it, i) => {
    if (it.square_variation_id && it.list_cents && it.list_cents > it.unit_cents) {
      const uid = 'sale-' + i;
      disc.push({ uid, name: 'Sale', type: 'FIXED_AMOUNT', amount_money: { amount: (it.list_cents - it.unit_cents) * it.qty, currency: 'USD' }, scope: 'LINE_ITEM' });
      order.line_items[i].applied_discounts = [{ discount_uid: uid }];
    }
  });
  if (disc.length) order.discounts = disc;
  if (shippingCents > 0) order.service_charges = [{ name: 'Shipping', amount_money: { amount: shippingCents, currency: 'USD' }, calculation_phase: 'TOTAL_PHASE' }];
  const recipient = { display_name: o.name, email_address: o.email, phone_number: o.phone };
  if (o.fulfillment === 'shipping') {
    recipient.address = { address_line_1: o.ship_street, address_line_2: o.ship_street2 || undefined, locality: o.ship_city, administrative_district_level_1: o.ship_state, postal_code: o.ship_zip, country: 'US' };
    order.fulfillments = [{ type: 'SHIPMENT', state: 'PROPOSED', shipment_details: { recipient } }];
  } else {
    order.fulfillments = [{ type: 'PICKUP', state: 'PROPOSED', pickup_details: { recipient, schedule_type: 'ASAP', note: 'Website order ' + o.code } }];
  }
  return order;
}
export async function calculate(env, o, items, shippingCents) {
  const c = await connection(env);
  const r = await api(env, 'POST', '/v2/orders/calculate', { order: orderBody(c, o, items, shippingCents) });
  return { total: r.order.total_money.amount, tax: r.order.total_tax_money?.amount || 0, subtotalFromSquare: r.order.total_money.amount - (r.order.total_tax_money?.amount || 0) - shippingCents };
}
export async function createOrder(env, o, items, shippingCents) {
  const c = await connection(env);
  const r = await api(env, 'POST', '/v2/orders', { idempotency_key: 'ord-' + o.code, order: orderBody(c, o, items, shippingCents) });
  return r.order;
}
export async function createPayment(env, { sourceId, verificationToken, amount, orderId, o }) {
  const c = await connection(env);
  const body = { source_id: sourceId, idempotency_key: 'pay-' + o.code + '-' + crypto.randomUUID().slice(0, 8), amount_money: { amount, currency: 'USD' },
    order_id: orderId, location_id: c.locationId, autocomplete: true, reference_id: o.code, buyer_email_address: o.email, note: 'Ageless website order ' + o.code };
  if (verificationToken) body.verification_token = verificationToken;
  if (o.fulfillment === 'shipping') body.shipping_address = { address_line_1: o.ship_street, address_line_2: o.ship_street2 || undefined, locality: o.ship_city, administrative_district_level_1: o.ship_state, postal_code: o.ship_zip, country: 'US' };
  return (await api(env, 'POST', '/v2/payments', body)).payment;
}
export async function getPayment(env, id) { return (await api(env, 'GET', `/v2/payments/${id}`)).payment; }
export async function refund(env, paymentId, amount, reason, key) {
  return (await api(env, 'POST', '/v2/refunds', { idempotency_key: key || crypto.randomUUID(), payment_id: paymentId, amount_money: { amount, currency: 'USD' }, reason: (reason || 'Refund').slice(0, 192) })).refund;
}

// ---------- webhooks ----------
export async function verifyWebhook(env, rawBody, signature, notificationUrl) {
  if (!env.SQUARE_WEBHOOK_SIGNATURE_KEY || !signature) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.SQUARE_WEBHOOK_SIGNATURE_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(notificationUrl + rawBody));
  const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return timingSafeEqual(expected, signature);
}
