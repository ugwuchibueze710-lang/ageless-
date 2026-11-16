// Admin AI assistant (Groq) + the contradiction check that runs before saves.
//
// Safety model:
//  - The assistant can READ anything the signed-in person can read (GET /admin/... through the normal router,
//    so the same permission checks apply).
//  - It can NOT change anything by itself. Changes come back as "proposals"; the person taps Confirm and the
//    browser sends them to /admin/ai/apply, which again runs them through the normal router as that person.
//  - Risky changes (refunds, cancels, deletes, staff access, Square disconnect…) need an extra "Yes, I'm sure".
import { getSettings } from './db.js';

export const aiConfigured = (env) => !!env.GROQ_API_KEY;
const MODEL = (env) => env.GROQ_MODEL || 'openai/gpt-oss-120b';

// ---------- what the assistant may touch ----------
const BLOCKED = [/^\/admin\/(setup|login|logout|password|bootstrap|join\/)/, /^\/admin\/ai\//, /^\/admin\/square\/connect$/];
export function allowedPath(method, path) {
  if (typeof path !== 'string' || !/^\/admin\/[\w\-\/]*(\?[\w=&%\-.,:]*)?$/.test(path)) return false;
  if (!['GET', 'POST', 'PUT', 'DELETE'].includes(method)) return false;
  return !BLOCKED.some((re) => re.test(path.split('?')[0]));
}
const RISKY = [
  [/^POST \/admin\/orders\/\d+\/refund$/, 'Sends money back to the customer\'s card through Square. This cannot be undone.'],
  [/^POST \/admin\/orders\/\d+\/cancel-unpaid$/, 'Cancels the order and emails the customer.'],
  [/^POST \/admin\/orders\/\d+\/items\/\d+\/remove$/, 'Removes an item from the customer\'s order.'],
  [/^DELETE \/admin\/products\/\d+$/, 'Deletes a product from the website (and from Square if connected).'],
  [/^DELETE \/admin\/categories\/\d+$/, 'Deletes a category.'],
  [/^DELETE \/admin\/images\/\d+$/, 'Deletes a product photo.'],
  [/^(POST|PUT) \/admin\/staff/, 'Changes who can log in or what they can do.'],
  [/^(POST|DELETE) \/admin\/invites/, 'Creates or cancels a staff invite link.'],
  [/^POST \/admin\/square\/disconnect$/, 'Turns off online payments until Square is connected again.'],
  [/^POST \/admin\/square\/(push|import|pull-stock)$/, 'Changes products or stock in Square / on the website in bulk.'],
  [/^POST \/admin\/orders\/\d+\/status$/, null], // checked below: only "canceled"/"completed" are risky
];
export function riskOf(a) {
  const key = `${a.method} ${String(a.path).split('?')[0]}`;
  for (const [re, why] of RISKY) {
    if (!re.test(key)) continue;
    if (why) return why;
    if (a.body && ['completed'].includes(a.body.status)) return 'Closes the order.';
  }
  if (key === 'PUT /admin/settings' && a.body && ('sale_percent' in a.body || 'sale_enabled' in a.body) && Number(a.body.sale_percent) >= 50) return 'Large sale: customers are charged this discounted price at checkout.';
  return null;
}

// ---------- the API the assistant knows about ----------
const CATALOG = `
READ (use admin_get):
GET /admin/dashboard — sales totals (if allowed), alerts, low stock, recent orders, Square/email status
GET /admin/orders?status=open|all|processing|ready_for_pickup|shipped|completed|canceled|refunded&q=<name/email/code>&fulfillment=pickup|shipping&from=YYYY-MM-DD&to=YYYY-MM-DD
GET /admin/orders/:id — full order with items, history, emails
GET /admin/orders/:id/items/:iid/alternatives — same-price in-stock replacements
GET /admin/products — every product with variations (id, name, price_cents, stock, available) and category
GET /admin/products/:id
GET /admin/categories
GET /admin/settings — all store settings, categories, active sale, Square/email status
GET /admin/staff — staff with permissions, online status (needs staff permission)
GET /admin/invites, GET /admin/activity?staff=<id>, GET /admin/outbox, GET /admin/log

CHANGE (use propose_change — nothing happens until the person confirms):
PUT /admin/settings — send ONLY the keys you change. Keys:
  sale_enabled (bool), sale_percent (1-90), sale_category_id (category id or "" for everything), sale_label (banner text), sale_ends (YYYY-MM-DD or "")
  site_announcement (text, "" hides), marquee_items (array of short strings for the rolling banner), store_address (text with \\n), store_hours ([["Days","Hours"],...])
  pickup_enabled, pay_in_store_enabled, pickup_instructions, pickup_ready_text, pickup_hold_days (1-30)
  shipping_enabled, shipping_mode ("flat"|"tiers"), shipping_flat_cents (DOLLARS as string e.g. "8.00"), shipping_free_over_cents (DOLLARS), shipping_tiers ([{min:"0",rate:"6"}]), shipping_note, shipping_time_text
  store_email, store_phone, hold_minutes (5-30)
  NOTE: only ONE store-wide sale exists at a time (all items or one category).
POST /admin/products — {name, description, category_id, featured, status:"active"|"hidden", variations:[{name, price:"12.99" (DOLLARS), stock (number or "" for not set), sku}]}
PUT /admin/products/:id — FULL product body as above; variations must include their existing "id" to keep them. Always GET the product first and send everything back with your edits.
DELETE /admin/products/:id
POST /admin/stock — {changes:[{variation_id, stock}]} (stock = whole number, or "" to unset)
POST /admin/categories {name} · PUT /admin/categories/:id {name, visible, sort} · DELETE /admin/categories/:id
POST /admin/orders/:id/status {status:"processing"|"ready_for_pickup"|"shipped"|"completed", carrier, tracking} — ready_for_pickup and shipped email the customer
POST /admin/orders/:id/paid-in-store {method:"cash"|"card"|"other"} — pay-at-pickup order paid at the counter, completes it
POST /admin/orders/:id/cancel-unpaid {reason} — unpaid pay-at-pickup order; puts items back in stock
POST /admin/orders/:id/note {note}
POST /admin/orders/:id/refund {full:true | amount:"5.00", reason, itemIds:[...], restock:bool, cancel:bool} — real money back through Square
POST /admin/orders/:id/items/:iid/unavailable · POST /admin/orders/:id/items/:iid/substitute {variation_id, message} · POST /admin/orders/:id/items/:iid/remove
POST /admin/orders/:id/resend {kind:"customer_confirmation"|"ready_for_pickup"|"shipped"}
POST /admin/substitutions/:id/withdraw · POST /admin/alerts/:id/resolve
POST /admin/invites {name, email, days, full, perms:[...]} · PUT /admin/staff/:id {perms:[...]|role|active|password}
POST /admin/square/push · POST /admin/square/pull-stock · POST /admin/square/disconnect · POST /admin/products/:id/sync
Permission names: orders, refunds, products, stock, sales, settings, staff, ai.
`;

function systemPrompt(me, s) {
  return `You are the Ageless store assistant inside the admin dashboard of Ageless, an anime/plush/collectibles shop in Eastland Mall, Evansville, Indiana.
You are talking to ${me.name} (${me.role === 'owner' ? 'owner, full access' : 'employee'}; permissions: ${me.perms.join(', ')}). Today is ${new Date().toISOString().slice(0, 10)}.
You can do anything in the admin that this person is allowed to do, on request, using the tools:
- admin_get: look things up. Always look up real IDs, names and current values before proposing a change. Never guess an ID or a price.
- propose_change: prepare a change. NOTHING is changed until the person taps Confirm. Make one proposal per API call needed (e.g. a sale is one settings change; three price changes on three products are three proposals).
Rules:
1. Be brief and plain. Talk like a helpful shop manager, not a programmer. No JSON or code in your replies.
2. Before proposing, check for contradictions with the current setup (e.g. a sale with no end date during a holiday, shipping turned on with no rates, a product with no quantity so nobody can buy it, pickup turned off while Square isn't connected so nobody can order at all). Point them out and suggest the fix.
3. If a request is ambiguous (which product? how long? all items or one category?), ask ONE short question instead of guessing.
4. For risky or hard-to-undo actions (refunds, cancellations, deletes, staff access, disconnecting Square, very large discounts) still prepare them if asked, but say clearly what will happen and recommend a safer option when there is one. If something looks like a mistake or would hurt the business, say you'd rather not and why — the person can still confirm.
5. If the person lacks permission for something, say so and suggest asking the owner.
6. Money: prices in proposals are dollars as strings ("12.99"). API responses show cents (price_cents: 1299 = $12.99).
7. After proposing, end with one line telling them to review and tap Confirm.
Current settings snapshot: sale ${s.sale_enabled === '1' ? `ON ${s.sale_percent}% ${s.sale_category_id ? 'category ' + s.sale_category_id : 'all items'}${s.sale_ends ? ' until ' + s.sale_ends : ''}` : 'off'}; pickup ${s.pickup_enabled === '1' ? 'on' : 'off'}; pay at pickup ${s.pay_in_store_enabled === '1' ? 'on' : 'off'}; shipping ${s.shipping_enabled === '1' ? 'on' : 'off'}.
API you can use:
${CATALOG}`;
}

const TOOLS = [
  { type: 'function', function: { name: 'admin_get', description: 'Read data from the store admin API (GET only).',
    parameters: { type: 'object', properties: { path: { type: 'string', description: 'e.g. /admin/products or /admin/orders?status=open' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'propose_change', description: 'Prepare a change for the person to confirm. Does NOT run it.',
    parameters: { type: 'object', properties: {
      method: { type: 'string', enum: ['POST', 'PUT', 'DELETE'] }, path: { type: 'string' }, body: { type: 'object', description: 'JSON body for the call' },
      summary: { type: 'string', description: 'One plain-English line describing exactly what will change, e.g. "Put Keychains & Charms 50% off until Nov 30".' },
    }, required: ['method', 'path', 'summary'] } } },
];

async function groq(env, messages, opts = {}) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), opts.timeout || 25000);
  try {
    const r = await fetch((env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1') + '/chat/completions', { method: 'POST', signal: ctl.signal,
      headers: { Authorization: 'Bearer ' + env.GROQ_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL(env), messages, temperature: 0.2, max_tokens: opts.max || 1200, ...(opts.tools ? { tools: opts.tools, tool_choice: 'auto' } : {}), ...(opts.json ? { response_format: { type: 'json_object' } } : {}) }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error?.message || `AI service error ${r.status}`);
    return j.choices[0].message;
  } catch (e) { if (e.name === 'AbortError') throw new Error('The AI took too long to answer. Try again.'); throw e; }
  finally { clearTimeout(t); }
}

const trim = (v, n = 6000) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s.length > n ? s.slice(0, n) + '…(cut)' : s; };

// history: [{role:'user'|'assistant', content}]  call: (method, path, body) => {status, data}
export async function aiChat(env, me, history, call) {
  if (!aiConfigured(env)) return { reply: 'The assistant is not set up yet. Your developer needs to add GROQ_API_KEY in Cloudflare.', proposals: [] };
  const s = await getSettings(env);
  const msgs = [{ role: 'system', content: systemPrompt(me, s) },
    ...history.slice(-16).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '').slice(0, 4000) }))];
  const proposals = [], looked = [];
  for (let step = 0; step < 8; step++) {
    const m = await groq(env, msgs, { tools: TOOLS });
    msgs.push({ role: 'assistant', content: m.content || '', ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}) });
    if (!m.tool_calls || !m.tool_calls.length) return { reply: (m.content || '').trim() || (proposals.length ? 'Review the changes below and tap Confirm.' : 'Done.'), proposals, looked };
    for (const tc of m.tool_calls) {
      let args = {}; try { args = JSON.parse(tc.function.arguments || '{}'); } catch { /* ignore */ }
      let out;
      if (tc.function.name === 'admin_get') {
        if (!allowedPath('GET', args.path)) out = { error: 'That path is not available.' };
        else { const r = await call('GET', args.path); out = r.status >= 400 ? { error: r.data?.error || `HTTP ${r.status}` } : r.data; looked.push(args.path.split('?')[0]); }
      } else if (tc.function.name === 'propose_change') {
        const a = { method: String(args.method || '').toUpperCase(), path: args.path, body: args.body && typeof args.body === 'object' ? args.body : undefined, summary: String(args.summary || '').slice(0, 300) };
        if (!allowedPath(a.method, a.path) || a.method === 'GET') out = { error: 'That change is not allowed through the assistant.' };
        else { a.risk = riskOf(a); a.id = proposals.length + 1; proposals.push(a); out = { ok: true, note: 'Queued for the person to confirm. Not applied yet.' + (a.risk ? ' RISKY: ' + a.risk : '') }; }
      } else out = { error: 'Unknown tool' };
      msgs.push({ role: 'tool', tool_call_id: tc.id, content: trim(out) });
    }
  }
  return { reply: proposals.length ? 'Here is what I prepared. Review it and tap Confirm.' : 'I could not finish that. Try asking in a simpler way.', proposals, looked };
}

// ---------- contradiction check before saving ----------
const money = (c) => '$' + (Number(c) / 100).toFixed(2);
export function ruleCheck(kind, d, ctx) {
  const out = [], add = (level, message, fix, patch) => out.push({ level, message, fix, patch });
  if (kind === 'settings') {
    const s = { ...ctx.settings, ...d };
    const on = (k) => s[k] === true || s[k] === '1';
    const pct = Number(s.sale_percent);
    if (on('sale_enabled') && !(pct >= 1 && pct <= 90)) add('error', 'The sale is turned on but has no valid percent off.', 'Enter a percent (1–90) or turn the sale off.', { sale_enabled: false });
    if (on('sale_enabled') && pct >= 60) add('warn', `${pct}% off is a very deep discount — every matching item is charged at that price.`, 'Double-check the percent before saving.');
    if (on('sale_enabled') && s.sale_ends && s.sale_ends < new Date().toISOString().slice(0, 10)) add('error', `The sale end date (${s.sale_ends}) is already in the past, so the sale would never show.`, 'Pick a future date or clear the end date.');
    if (on('sale_enabled') && !String(s.sale_label || '').trim()) add('warn', 'The sale has no banner text, so the banner will just say "' + (pct || 'X') + '% off".', 'Add banner text like "Black Friday — ' + (pct || 'X') + '% off".', { sale_label: (pct ? pct + '% off ' : '') + (s.sale_category_id ? (ctx.categories.find((c) => String(c.id) === String(s.sale_category_id))?.name || '') : 'everything') });
    if (on('sale_enabled') && !s.sale_ends) add('warn', 'The sale has no end date — it stays on until someone turns it off.', 'Add a last day so it ends by itself.');
    const shipRates = s.shipping_mode === 'tiers' ? (Array.isArray(s.shipping_tiers) ? s.shipping_tiers.length : (() => { try { return JSON.parse(s.shipping_tiers || '[]').length; } catch { return 0; } })()) : String(s.shipping_flat_cents ?? '').trim() !== '';
    if (on('shipping_enabled') && !shipRates) add(ctx.squareConnected ? 'error' : 'warn', 'Home delivery is on, but there is no shipping price, so customers can\'t check out with delivery.', 'Enter a flat rate (e.g. $8.00) or turn delivery off.', { shipping_enabled: false });
    if (on('shipping_enabled') && !ctx.squareConnected) add('warn', 'Home delivery won\'t appear on the website until Square is connected, because delivery orders must be paid online.', 'Connect Square in Settings when you\'re ready.');
    if (!on('pickup_enabled') && !ctx.squareConnected) add('error', 'Pickup is off and Square isn\'t connected — customers would have no way to order at all.', 'Keep in-store pickup on until Square is connected.', { pickup_enabled: true });
    if (!on('pickup_enabled') && !on('shipping_enabled')) add('error', 'Both pickup and delivery are off — nobody can order online.', 'Turn on at least one.', { pickup_enabled: true });
    if (!on('pickup_enabled') && on('pay_in_store_enabled')) add('warn', '"Pay at the store" only works with pickup, and pickup is off.', 'Turn pickup back on, or ignore this.');
    if (Number(s.pickup_hold_days) > 14) add('warn', `Holding unpaid pickup orders for ${s.pickup_hold_days} days keeps those items off the shelf a long time.`, 'Most stores hold 2–5 days.');
    if (s.shipping_free_over_cents && shipRates && s.shipping_mode !== 'tiers' && Number(String(s.shipping_free_over_cents).replace(/[$,]/g, '')) <= Number(String(s.shipping_flat_cents).replace(/[$,]/g, ''))) add('warn', 'The free-shipping minimum is lower than the shipping price itself, so almost every order ships free.', 'Raise the free-shipping minimum (e.g. $50).');
    if (!String(s.store_email || '').trim()) add('warn', 'No email for new-order alerts — nobody gets notified when an order comes in.', 'Add Nathan\'s email under Store contact.');
    const mq = Array.isArray(s.marquee_items) ? s.marquee_items.filter((x) => String(x).trim()) : null;
    if (mq && !mq.length) add('warn', 'The rolling banner has no words, so it will keep the old ones.', 'Add at least one line.');
  }
  if (kind === 'product') {
    const vars = Array.isArray(d.variations) ? d.variations : [];
    if (!vars.length) add('error', 'This product has no price.', 'Add at least one price.');
    vars.forEach((v) => {
      const p = Number(String(v.price ?? '').replace(/[$,]/g, ''));
      if (!(p > 0)) add('error', `"${v.name || 'Regular'}" has a price of $0 — it would be free at checkout.`, 'Enter the real price.');
      if (d.status !== 'hidden' && (v.stock === '' || v.stock == null)) add('warn', `"${v.name || 'Regular'}" has no quantity set, so it shows "In store only" and can't be bought online.`, 'Enter how many you have.');
    });
    if (d.featured && vars.length && vars.every((v) => v.stock !== '' && v.stock != null && Number(v.stock) === 0)) add('warn', 'This product is featured but has 0 in stock.', 'Un-feature it or add stock.');
    const names = vars.map((v) => String(v.name || 'Regular').trim().toLowerCase());
    if (new Set(names).size !== names.length) add('error', 'Two options have the same name — customers couldn\'t tell them apart.', 'Give each option a different name (e.g. Small / Large).');
    if (d.featured && d.status === 'hidden') add('warn', 'This product is featured but hidden, so it won\'t show anywhere.', 'Make it active or un-feature it.', { featured: false });
    if (d.status !== 'hidden' && !ctx.hasPhoto) add('warn', 'No photo yet — products without photos sell much less.', 'Add a photo with the camera button after saving.');
    if (ctx.salePct && ctx.saleApplies) add('warn', `A ${ctx.salePct}% sale is running on this item's category — customers will pay ${vars.map((v) => '$' + (Number(String(v.price).replace(/[$,]/g, '')) * (100 - ctx.salePct) / 100).toFixed(2)).join(' / ')}.`, null);
  }
  return out;
}

export async function aiReview(env, kind, data, ctx, issues) {
  if (!aiConfigured(env)) return null;
  try {
    const m = await groq(env, [
      { role: 'system', content: 'You review a store admin change before it is saved, for an anime/plush shop. Find contradictions, mistakes or risky setups that the listed automatic checks missed. Be conservative: only report real problems a shop owner would want to know. Reply ONLY with JSON: {"issues":[{"level":"error"|"warn","message":"plain English","fix":"suggested fix"}],"note":"one short line"}. Return {"issues":[]} if nothing is wrong. Never repeat an issue already listed.' },
      { role: 'user', content: `Change type: ${kind}\nNew values: ${trim(data, 3000)}\nCurrent context: ${trim(ctx, 2500)}\nAlready found: ${trim(issues.map((i) => i.message), 1500)}` },
    ], { json: true, timeout: 9000, max: 500 });
    const j = JSON.parse(m.content || '{}');
    return { issues: (Array.isArray(j.issues) ? j.issues : []).slice(0, 5).map((i) => ({ level: i.level === 'error' ? 'error' : 'warn', message: String(i.message || '').slice(0, 300), fix: i.fix ? String(i.fix).slice(0, 300) : null, ai: true })).filter((i) => i.message), note: j.note ? String(j.note).slice(0, 200) : null };
  } catch { return null; }
}
