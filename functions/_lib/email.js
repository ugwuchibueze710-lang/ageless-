// Email notifications. Every message is recorded in the admin Outbox. If RESEND_API_KEY and
// EMAIL_FROM are set, it is also sent through Resend; otherwise it is marked "not sent" so the
// owner can see exactly what still needs to go out.
import { esc, money, nowIso, log } from './util.js';
import { getSettings } from './db.js';

export async function sendEmail(env, { to, subject, html, orderId, replyTo }) {
  let status = 'not_configured', error = null;
  if (to && env.RESEND_API_KEY && env.EMAIL_FROM) {
    try {
      const r = await fetch('https://api.resend.com/emails', { method: 'POST',
        headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject, html, ...(replyTo && /@/.test(replyTo) ? { reply_to: replyTo } : {}) }) });
      if (r.ok) status = 'sent'; else { status = 'failed'; error = (await r.text()).slice(0, 500); }
    } catch (e) { status = 'failed'; error = String(e).slice(0, 500); }
    if (status === 'failed') await log(env, 'error', 'Email failed', { to, subject, error });
  }
  await env.DB.prepare('INSERT INTO outbox (to_email, subject, body_html, order_id, status, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(to || '(store email not set)', subject, html, orderId || null, status, error, nowIso()).run();
  return status;
}

let FOOT = 'Ageless · Inside Eastland Mall · 800 N Green River Rd, Evansville, IN 47715';
function shell(title, inner) {
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:auto;color:#14101c">
  <h2 style="font-family:Georgia,serif;letter-spacing:.06em">AGELESS</h2><h3>${esc(title)}</h3>${inner}
  <p style="color:#777;font-size:12px;margin-top:28px">${esc(FOOT)}</p></div>`;
}
function absUrl(site, u) {
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  return site ? site + (u.startsWith('/') ? '' : '/') + u : '';
}
function itemsTable(items, site) {
  items = items.filter((i) => i.status !== 'canceled');
  return `<table style="width:100%;border-collapse:collapse">${items.map((i) => {
    const img = absUrl(site, i.image_url);
    return `<tr><td style="padding:8px 0;border-bottom:1px solid #eee;width:64px">${img ? `<img src="${esc(img)}" alt="" width="56" height="56" style="width:56px;height:56px;object-fit:cover;border-radius:8px;display:block">` : ''}</td>` +
      `<td style="padding:8px 10px;border-bottom:1px solid #eee">${esc(i.name)}${i.variation_name && i.variation_name !== 'Regular' ? ' — ' + esc(i.variation_name) : ''} × ${i.qty}</td>` +
      `<td style="text-align:right;border-bottom:1px solid #eee;white-space:nowrap">${money(i.unit_cents * i.qty)}</td></tr>`;
  }).join('')}</table>`;
}
// "2026-11-20" -> "Friday, November 20"
export function prettyDate(d) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d || '')) return '';
  const t = new Date(d + 'T12:00:00Z');
  return t.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
}
function totals(o) {
  const unpaid = o.payment_method === 'store' && !o.paid_at;
  return `<p>${o.discount_cents ? 'You saved ' + money(o.discount_cents) + ' · ' : ''}Subtotal ${money(o.subtotal_cents)}${o.shipping_cents ? ' · Shipping ' + money(o.shipping_cents) : ''}${o.tax_cents ? ' · Tax ' + money(o.tax_cents) : ''}<br>` +
    (unpaid ? `<b>Due at pickup: ${money(o.total_cents)}</b> <span style="color:#777">(plus sales tax, if any, at the register)</span>` : `<b>Total ${money(o.total_cents)}</b>`) + '</p>';
}

export async function notify(env, kind, o, items, extra = {}) {
  const s = await getSettings(env);
  let site = extra.site || (env.SITE_URL || '').replace(/\/$/, '');
  if (!site && extra.link) { try { site = new URL(extra.link).origin; } catch { /* no link */ } }
  const items_ = (list) => itemsTable(list, site);
  if (s.store_address) FOOT = 'Ageless · ' + s.store_address.replace(/\n+/g, ' · ');
  const unpaid = !!o && o.payment_method === 'store' && !o.paid_at;
  const eta = !o ? '' : o.fulfillment === 'pickup'
    ? (s.pickup_ready_text ? `<p><b>When will it be ready?</b> ${esc(s.pickup_ready_text)} We'll email you the moment it's ready.</p>` : '')
    : `<p><b>When will it arrive?</b> ${s.shipping_time_text ? esc(s.shipping_time_text) + ' ' : ''}We'll email you the exact delivery day as soon as it ships.</p>`;
  const arrive = o && o.eta_date ? `<p style="font-size:18px;background:#f3eefc;padding:12px 14px;border-radius:10px">Arriving <b>${esc(prettyDate(o.eta_date))}</b></p>` : '';
  const etaNote = o && o.eta_note ? `<p>${esc(o.eta_note)}</p>` : '';
  const track = o && (o.tracking_number || o.tracking_carrier) ? `<p>${o.tracking_carrier ? 'Carrier: <b>' + esc(o.tracking_carrier) + '</b>' : ''}${o.tracking_carrier && o.tracking_number ? ' · ' : ''}${o.tracking_number ? 'Tracking number: <b>' + esc(o.tracking_number) + '</b>' : ''}</p>` : '';
  const hours = s.store_hours ? (() => { try { const h = JSON.parse(s.store_hours); return Array.isArray(h) && h.length ? '<p style="color:#555"><b>Store hours</b><br>' + h.map((r) => esc((r.days || r[0] || '') + ': ' + (r.hours || r[1] || ''))).join('<br>') + '</p>' : ''; } catch { return ''; } })() : '';
  const link = extra.link ? `<p><a href="${esc(extra.link)}" style="background:#14101c;color:#fff;padding:10px 18px;border-radius:20px;text-decoration:none">${esc(extra.linkText || 'View your order')}</a></p>` : '';
  const fulfil = !o ? '' : o.fulfillment === 'pickup'
    ? `<p><b>In-store pickup.</b> ${esc(kind === 'ready_for_pickup' ? String(s.pickup_instructions || '').replace(/\s*We(?:'ll| will) email you[^.]*\.?/gi, '') : (s.pickup_instructions || ''))}</p>`
    : `<p><b>Shipping to:</b><br>${esc(o.name)}<br>${esc(o.ship_street)}${o.ship_street2 ? '<br>' + esc(o.ship_street2) : ''}<br>${esc(o.ship_city)}, ${esc(o.ship_state)} ${esc(o.ship_zip)}</p>`;
  const M = {
    store_new_order: [s.store_email, `New ${o.fulfillment === 'pickup' ? 'PICKUP' : 'SHIPPING'} order ${o.code} — ${money(o.total_cents)}${unpaid ? ' — PAY AT PICKUP' : ' — PAID'}`,
      shell(`New order ${o.code}`, `${unpaid ? '<p style="background:#fff3cd;padding:8px 12px;border-radius:8px"><b>Not paid yet</b> — the customer pays when they pick up. Pull the items and keep them aside.</p>' : ''}<p>${esc(o.name)} · ${esc(o.phone)} · ${esc(o.email)}</p>${items_(items)}${totals(o)}${fulfil}${o.notes ? '<p>Note: ' + esc(o.notes) + '</p>' : ''}${link}`)],
    customer_confirmation: unpaid
      ? [o.email, `Your Ageless pickup order ${o.code} is reserved`,
        shell('Your order is reserved!', `<p>Thanks, ${esc(o.name.split(' ')[0])}! Order <b>${o.code}</b> is set aside for you. <b>You pay when you pick it up</b> — cash or card at the counter.</p>${items_(items)}${totals(o)}${eta}${fulfil}<p>We'll hold your order for ${Number(s.pickup_hold_days) || 3} days. Can't make it? Just reply or call ${esc(s.store_phone || 'the store')}.</p>${link}`)]
      : [o.email, `Your Ageless order ${o.code} is confirmed`,
        shell('Thank you for your order!', `<p>Order <b>${o.code}</b> is paid.</p>${items_(items)}${totals(o)}${eta}${fulfil}${link}`)],
    ready_for_pickup: [o.email, `Order ${o.code} is ready for pickup`,
      shell('Your order is ready!', `<p>Good news, ${esc((o.name || '').split(' ')[0])}! Order <b>${o.code}</b> is packed and ready — come pick it up at Ageless.</p>${items_(items)}${unpaid ? `<p><b>Amount due at pickup: ${money(o.total_cents)}</b> (plus sales tax, if any).</p>` : '<p>It\'s already paid — just give us your name or order number.</p>'}${fulfil}<p>We'll hold it for ${Number(s.pickup_hold_days) || 3} days.</p>${hours}${link}`)],
    shipped: [o.email, `Order ${o.code} is on its way${o.eta_date ? ' — arriving ' + prettyDate(o.eta_date) : ''}`,
      shell('Your order is on its way!', `<p>Order <b>${o.code}</b> has shipped.</p>${arrive}${etaNote}${track}${items_(items)}${fulfil}${link}`)],
    delivery_update: [o.email, `New delivery date for order ${o.code}${o.eta_date ? ': ' + prettyDate(o.eta_date) : ''}`,
      shell('Your delivery date changed', `<p>We have an update on order <b>${o.code}</b>.</p>${arrive}${etaNote}${track}${items_(items)}${link}`)],
    substitution_offer: [o.email, `Action needed: an item in order ${o.code} is unavailable`,
      shell('An item you ordered is no longer available', `<p>Sorry — <b>${esc(extra.original)}</b> sold out after your order.</p><p>We can send <b>${esc(extra.offered)}</b> instead, at the same price (${money(extra.unit_cents)} each). Nothing changes unless you approve it. If you decline, we ${unpaid ? 'take that item off your order (you pay nothing for it)' : 'refund that item'}.</p>${link}`)],
    refund: [o.email, `Refund issued for order ${o.code}`,
      shell('Refund issued', `<p>We refunded <b>${money(extra.amount)}</b> to your card for order <b>${o.code}</b>${extra.reason ? ' (' + esc(extra.reason) + ')' : ''}. Banks usually show it within 5–10 business days.</p>${link}`)],
    canceled: [o.email, `Order ${o.code} was canceled`,
      shell('Order canceled', `<p>Order <b>${o.code}</b> was canceled.${extra.reason ? ' ' + esc(extra.reason) : ''}</p>${link}`)],
    store_alert: [s.store_email, `Action needed: ${extra.subject || 'store alert'}`, shell('Store alert', `<p>${esc(extra.message)}</p>${link}`)],
  };
  const m = M[kind]; if (!m) return;
  return sendEmail(env, { to: m[0], subject: m[1], html: m[2], orderId: o?.id, replyTo: m[0] === s.store_email ? null : s.store_email });
}
