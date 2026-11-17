// Website on/off switch (flipped from BDT). While the site is OFF, the store pages are not served at all:
// visitors get a "back soon" page instead. The admin (/admin) and the API keep working.
import { getSettings } from './_lib/db.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function backSoon(message) {
  const msg = esc(message || 'Our online store is closed for a moment. You can still visit us inside Eastland Mall.');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ageless — We'll be right back</title><meta name="robots" content="noindex"><link rel="icon" href="/assets/img/logo-sm.png">
<style>html,body{height:100%;margin:0}body{display:grid;place-items:center;background:#09080d;color:#f7f5fb;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:24px;box-sizing:border-box;text-align:center}
img{width:170px;margin-bottom:18px}h1{font-size:1.7rem;margin:0 0 10px}p{max-width:440px;line-height:1.5;margin:0 auto 8px;color:#d8d2e6}small{color:#9b93ad}</style></head>
<body><main><img src="/assets/img/logo-sm.png" alt="Ageless"><h1>We'll be right back</h1><p>${msg}</p><small>Ageless · Eastland Mall · 800 N Green River Rd, Evansville, IN</small></main>
<script>setTimeout(function(){location.reload()},60000)</script></body></html>`;
}

export async function onRequest(ctx) {
  const { request, env, next } = ctx;
  const path = new URL(request.url).pathname;
  if (path.startsWith('/api/') || path.startsWith('/admin') || request.method !== 'GET') return next();
  try {
    const s = await getSettings(env);
    if (s.site_offline === '1') {
      return new Response(backSoon(s.site_offline_message), { status: 503, headers: {
        'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '300',
        'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self'", 'X-Content-Type-Options': 'nosniff' } });
    }
  } catch { /* if the switch can't be read, keep the site up */ }
  return next();
}
