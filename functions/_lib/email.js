// Email notifications. Every message is recorded in the admin Outbox. If RESEND_API_KEY and
// EMAIL_FROM are set, it is also sent through Resend; otherwise it is marked "not sent" so the
// owner can see exactly what still needs to go out.
import { esc, money, nowIso, log } from './util.js';
import { getSettings } from './db.js';

export async function sendEmail(env, { to, subject, html, orderId }) {
  let status = 'not_configured', error = null;
  if (to && env.RESEND_API_KEY && env.EMAIL_FROM) {
    try {
      const r = await fetch('https://api.resend.com/emails', { method: 'POST',
        headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject, html }) });
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
function itemsTable(items) {
  items = items.filter((i) => i.status !== 'canceled');
  return `<table style="width:100%;border-collapse:collapse">${items.map((i) => `<tr><td style="padding:6px 0;border-bottom:1px solid #eee">${esc(i.name)}${i.variation_name && i.variation_name !== 'Regular' ? ' — ' + esc(i.variation_name) : ''} × ${i.qty}</td><td style="text-align:right;border-bottom:1px solid #eee">${money(i.unit_cents * i.qty)}</td></tr>`).join('')}</table>`;
}
function totals(o) {
  const unpaid = o.payment_method === 'store' && !o.paid_at;
  return `<p>${o.discount_cents ? 'You saved ' + money(o.discount_cents) + ' · ' : ''}Subtotal ${money(o.subtotal_cents)}${o.shipping_cents ? ' · Shipping ' + money(o.shipping_cents) : ''}${o.tax_cents ? ' · Tax ' + money(o.tax_cents) : ''}<br>` +
    (unpaid ? `<b>Due at pickup: ${money(o.total_cents)}</b> <span style="color:#777">(plus sales tax, if any, at the register)</span>` : `<b>Total ${money(o.total_cents)}</b>`) + '</p>';
}

export async function notify(env, kind, o, items, extra = {}) {
  const s = await getSettings(env);
  if (s.store_address) FOOT = 'Ageless · ' + s.store_address.replace(/\n+/g, ' · ');
  const unpaid = !!o && o.payment_method === 'store' && !o.paid_at;
  const eta = !o ? '' : o.fulfillment === 'pickup'
    ? (s.pickup_ready_text ? `<p><b>When will it be ready?</b> ${esc(s.pickup_ready_text)} We'll email you the moment it's ready.</p>` : '')
    : (s.shipping_time_text ? `<p><b>When will it ship?</b> ${esc(s.shipping_time_text)} We'll email you the tracking number.</p>` : '');
  const link = extra.link ? `<p><a href="${esc(extra.link)}" style="background:#14101c;color:#fff;padding:10px 18px;border-radius:20px;text-decoration:none">${esc(extra.linkText || 'View your order')}</a></p>` : '';
  const fulfil = !o ? '' : o.fulfillment === 'pickup'
    ? `<p><b>In-store pickup.</b> ${esc(s.pickup_instructions || '')}</p>`
    : `<p><b>Shipping to:</b><br>${esc(o.name)}<br>${esc(o.ship_street)}${o.ship_street2 ? '<br>' + esc(o.ship_street2) : ''}<br>${esc(o.ship_city)}, ${esc(o.ship_state)} ${esc(o.ship_zip)}</p>`;
  const M = {
    store_new_order: [s.store_email, `New ${o.fulfillment === 'pickup' ? 'PICKUP' : 'SHIPPING'} order ${o.code} — ${money(o.total_cents)}${unpaid ? ' — PAY AT PICKUP' : ' — PAID'}`,
      shell(`New order ${o.code}`, `${unpaid ? '<p style="background:#fff3cd;padding:8px 12px;border-radius:8px"><b>Not paid yet</b> — the customer pays when they pick up. Pull the items and keep them aside.</p>' : ''}<p>${esc(o.name)} · ${esc(o.phone)} · ${esc(o.email)}</p>${itemsTable(items)}${totals(o)}${fulfil}${o.notes ? '<p>Note: ' + esc(o.notes) + '</p>' : ''}${link}`)],
    customer_confirmation: unpaid
      ? [o.email, `Your Ageless pickup order ${o.code} is reserved`,
        shell('Your order is reserved!', `<p>Thanks, ${esc(o.name.split(' ')[0])}! Order <b>${o.code}</b> is set aside for you. <b>You pay when you pick it up</b> — cash or card at the counter.</p>${itemsTable(items)}${totals(o)}${eta}${fulfil}<p>We'll hold your order for ${Number(s.pickup_hold_days) || 3} days. Can't make it? Just reply or call ${esc(s.store_phone || 'the store')}.</p>${link}`)]
      : [o.email, `Your Ageless order ${o.code} is confirmed`,
        shell('Thank you for your order!', `<p>Order <b>${o.code}</b> is paid.</p>${itemsTable(items)}${totals(o)}${eta}${fulfil}${link}`)],
    ready_for_pickup: [o.email, `Order ${o.code} is ready for pickup`,
      shell('Your order is ready!', `<p>Order <b>${o.code}</b> is ready for pickup.</p>${unpaid ? `<p><b>Amount due at pickup: ${money(o.total_cents)}</b> (plus sales tax, if any).</p>` : ''}${fulfil}${link}`)],
    shipped: [o.email, `Order ${o.code} has shipped`,
      shell('Your order is on its way', `<p>Order <b>${o.code}</b> has shipped${o.tracking_carrier ? ' with ' + esc(o.tracking_carrier) : ''}.${o.tracking_number ? ' Tracking number: <b>' + esc(o.tracking_number) + '</b>' : ''}</p>${link}`)],
    substitution_offer: [o.email, `Action needed: an item in order ${o.code} is unavailable`,
      shell('An item you ordered is no longer available', `<p>Sorry — <b>${esc(extra.original)}</b> sold out after your order.</p><p>We can send <b>${esc(extra.offered)}</b> instead, at the same price (${money(extra.unit_cents)} each). Nothing changes unless you approve it. If you decline, we ${unpaid ? 'take that item off your order (you pay nothing for it)' : 'refund that item'}.</p>${link}`)],
    refund: [o.email, `Refund issued for order ${o.code}`,
      shell('Refund issued', `<p>We refunded <b>${money(extra.amount)}</b> to your card for order <b>${o.code}</b>${extra.reason ? ' (' + esc(extra.reason) + ')' : ''}. Banks usually show it within 5–10 business days.</p>${link}`)],
    canceled: [o.email, `Order ${o.code} was canceled`,
      shell('Order canceled', `<p>Order <b>${o.code}</b> was canceled.${extra.reason ? ' ' + esc(extra.reason) : ''}</p>${link}`)],
    store_alert: [s.store_email, `Action needed: ${extra.subject || 'store alert'}`, shell('Store alert', `<p>${esc(extra.message)}</p>${link}`)],
  };
  const m = M[kind]; if (!m) return;
  return sendEmail(env, { to: m[0], subject: m[1], html: m[2], orderId: o?.id });
}
