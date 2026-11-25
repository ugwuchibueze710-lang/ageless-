// BDT Site Protocol v1 — lets Black Daddy Tech's admin watch and control this website with one key.
// See bdt-website/docs/SITE-PROTOCOL.md. Only technical data and store controls go to BDT:
// never customer names, emails, phone numbers or addresses.
import { sha256Hex, nowIso, token, fail } from './util.js';

export const PROTOCOL = 1;
export const CAPABILITIES = ['summary', 'info', 'issues', 'commands', 'metrics', 'messages', 'power', 'control'];
export const KEY_PREFIX = 'bdtc1_';

export function version(env) {
  return (env.CF_PAGES_COMMIT_SHA || '').slice(0, 7) || 'live';
}

// ---------- the connection key ----------
// Shown once as bdtc1_<base64url({"u": base, "k": secret})>; only a hash of the secret is stored.
export async function createKey(env, base, staffId) {
  const k = 'itk_' + token(32);
  await env.DB.prepare('INSERT INTO bdt_keys (key_hash, hint, created_by, created_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256Hex(k), k.slice(-4), staffId || null, nowIso()).run();
  const json = JSON.stringify({ u: `${base}/api/it/bdt`, k });
  const b64 = btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return KEY_PREFIX + b64;
}

// Every call from BDT carries "Authorization: Bearer <k>". Wrong or revoked key → 401.
export async function requireBdt(env, request) {
  const m = (request.headers.get('authorization') || '').match(/^Bearer\s+(\S+)$/i);
  if (!m || m[1].length < 32) fail(401, 'Missing or invalid key.');
  const h = await sha256Hex(m[1]);
  const row = await env.DB.prepare('SELECT id FROM bdt_keys WHERE key_hash = ? AND revoked_at IS NULL').bind(h).first();
  if (!row) fail(401, 'This key was revoked or never existed.');
  await env.DB.prepare('UPDATE bdt_keys SET last_used_at = ? WHERE id = ?').bind(nowIso(), row.id).run();
  await env.DB.prepare('UPDATE bdt_link SET last_pull_at = ? WHERE id = 1').bind(nowIso()).run().catch(() => {});
  return row;
}

// ---------- the BDT secret (kept encrypted with TOKEN_KEY) ----------
async function aesKey(env) {
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('bdt-link:' + (env.TOKEN_KEY || 'ageless')));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
const b64e = (u8) => btoa(String.fromCharCode(...u8));
const b64d = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export async function encrypt(env, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(env), new TextEncoder().encode(text)));
  return b64e(iv) + '.' + b64e(ct);
}
export async function decrypt(env, enc) {
  const [iv, ct] = String(enc).split('.');
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(iv) }, await aesKey(env), b64d(ct)));
}
export async function getLink(env) {
  try { return await env.DB.prepare('SELECT * FROM bdt_link WHERE id = 1').first(); } catch { return null; }
}

// ---------- pushing to BDT (signed like the BDT connector) ----------
async function hmacHex(secret, data) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)));
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export async function pushToBdt(env, path, body) {
  const r = await callBdt(env, path, body, 6000);
  return r.skipped ? r : { status: r.status };
}
/** Signed request to BDT that also returns BDT's JSON answer (used for the monthly bill). */
export async function callBdt(env, path, body, timeoutMs = 10000) {
  const link = await getLink(env); if (!link) return { skipped: 'not connected' };
  const secret = await decrypt(env, link.secret_enc);
  const raw = JSON.stringify(body), ts = String(Math.floor(Date.now() / 1000)), nonce = token(12);
  const res = await fetch(link.bdt_url.replace(/\/$/, '') + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-bdt-site': link.site_id, 'x-bdt-timestamp': ts, 'x-bdt-nonce': nonce,
      'x-bdt-signature': await hmacHex(secret, `${ts}.${nonce}.${raw}`), 'user-agent': 'Ageless/1.0' },
    body: raw, signal: AbortSignal.timeout(timeoutMs),
  });
  let data = null; try { data = await res.json(); } catch { /* not JSON */ }
  return { status: res.status, data };
}

// ---------- issues ----------
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_RE = /\+?\d[\d\s().-]{8,}\d/g;
export const scrub = (s, n = 2000) => (s == null ? null : String(s).replace(EMAIL_RE, '[email]').replace(PHONE_RE, '[phone]').slice(0, n));

export function issueShape(r) {
  let meta = null; try { meta = r.meta ? JSON.parse(r.meta) : null; } catch { /* keep null */ }
  return { id: r.id, kind: r.kind, level: r.level, title: r.title, message: r.message, stack: r.stack, path: r.path, route: r.route,
    element: r.element, source: r.source, count: r.count, firstSeen: r.first_seen, lastSeen: r.last_seen, release: meta?.release || null, meta };
}

// Record (or count again) an issue, then push it to BDT right away. Never throws.
export async function recordIssue(env, i) {
  try {
    const kind = i.kind || 'other', title = scrub(i.title, 200) || 'Problem';
    const id = 'iss_' + (await sha256Hex(`${kind}|${title}|${i.route || ''}|${i.element || ''}`)).slice(0, 20);
    const now = nowIso(), meta = JSON.stringify({ ...(i.meta || {}), release: version(env) }).slice(0, 1500);
    await env.DB.prepare(`INSERT INTO site_issues (id, kind, level, title, message, stack, path, route, element, source, count, first_seen, last_seen, meta)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET count = count + 1, last_seen = excluded.last_seen, message = excluded.message, stack = excluded.stack,
        path = excluded.path, level = excluded.level, meta = excluded.meta, cleared_at = NULL`)
      .bind(id, kind, i.level || 'error', title, scrub(i.message), scrub(i.stack, 4000), scrub(i.path, 300), i.route || null, i.element || null,
        i.source || 'server', now, now, meta).run();
    const row = await env.DB.prepare('SELECT * FROM site_issues WHERE id = ?').bind(id).first();
    await pushToBdt(env, '/api/connect/errors', { errors: [issueShape(row)] }).catch(() => {});
  } catch { /* reporting must never break the site */ }
}

// Map the app's own log lines to issues for BDT (customer details are removed first).
export function issueFromLog(level, msg, detail) {
  if (msg === 'Failed admin login') return null; // normal, not a problem to fix
  const d = detail || {};
  if (msg === 'Unhandled API error') return { kind: 'server_error', level: 'error', title: `Server error on ${d.method || ''} ${d.path || ''}`.trim(), message: String(d.error || '').split('\n')[0], stack: d.error, path: d.path, route: `${d.method || ''} ${d.path || ''}`.trim(), source: 'server', meta: { status: 500 } };
  if (/webhook/i.test(msg)) return { kind: 'security', level: 'warning', title: msg, message: 'Square sent an update the site could not verify. Check SQUARE_WEBHOOK_SIGNATURE_KEY.', route: 'POST /api/square/webhook', source: 'check' };
  if (msg === 'Email failed') return { kind: 'other', level: 'error', title: 'A customer email failed to send', message: String(d.error || ''), route: 'email', source: 'job' };
  if (/^Square/.test(msg)) return { kind: 'job_failure', level, title: msg, message: typeof d === 'object' ? JSON.stringify(d.e || d.errors || d).slice(0, 500) : String(d), route: 'square', source: 'job' };
  if (/^AI /.test(msg)) return { kind: 'other', level: 'warning', title: msg, message: String(d.e || '').slice(0, 500), route: 'ai', source: 'server' };
  if (level === 'error') return { kind: 'other', level: 'error', title: msg, message: typeof d === 'object' ? JSON.stringify(d).slice(0, 500) : String(d), source: 'server' };
  return null;
}

// ---------- request stats (for metrics) ----------
export async function countRequest(env, ms, isError, isPageview) {
  try {
    const minute = new Date().toISOString().slice(0, 16);
    await env.DB.prepare(`INSERT INTO req_stats (minute, requests, errors, total_ms, pageviews) VALUES (?, 1, ?, ?, ?)
      ON CONFLICT(minute) DO UPDATE SET requests = requests + 1, errors = errors + excluded.errors, total_ms = total_ms + excluded.total_ms, pageviews = pageviews + excluded.pageviews`)
      .bind(minute, isError ? 1 : 0, Math.round(ms), isPageview ? 1 : 0).run();
    if (Math.random() < 0.01) await env.DB.prepare('DELETE FROM req_stats WHERE minute < ?').bind(new Date(Date.now() - 8 * 864e5).toISOString().slice(0, 16)).run();
  } catch { /* never block */ }
}
export async function metrics(env, minutes) {
  const since = new Date(Date.now() - minutes * 60e3).toISOString().slice(0, 16);
  const r = await env.DB.prepare('SELECT COALESCE(SUM(requests),0) AS requests, COALESCE(SUM(errors),0) AS errors, COALESCE(SUM(total_ms),0) AS ms, COALESCE(SUM(pageviews),0) AS pv FROM req_stats WHERE minute >= ?').bind(since).first();
  return { requests: r.requests, errors: r.errors, errorRate: r.requests ? +(r.errors / r.requests).toFixed(4) : 0, avgMs: r.requests ? Math.round(r.ms / r.requests) : 0, pageviews: r.pv };
}
