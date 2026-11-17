// Shared helpers for the Ageless API (Cloudflare Pages Functions).

export class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}

const SEC_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...SEC_HEADERS, ...headers } });
}

export function fail(status, message, extra) { throw new HttpError(status, message, extra); }

export async function readJson(request, maxBytes = 64 * 1024) {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > maxBytes) fail(413, 'Request too large');
  const text = await request.text();
  if (text.length > maxBytes) fail(413, 'Request too large');
  if (!text) return {};
  try { return JSON.parse(text); } catch { fail(400, 'Invalid JSON'); }
}

// ---- validation ----
export const str = (v, max = 200) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
export const text = (v, max = 4000) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);
export const int = (v, min = 0, max = 1e9) => { if (v == null || v === '' || typeof v === 'boolean') return null; const n = Math.trunc(Number(v)); if (!Number.isFinite(n)) return null; return Math.min(max, Math.max(min, n)); };
export const isEmail = (e) => /^[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}$/i.test(e);
export const isPhone = (p) => /^[+()\-.\s\d]{7,20}$/.test(p) && (p.match(/\d/g) || []).length >= 7;
export const US_STATES = 'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR'.split(' ');
export const isZip = (z) => /^\d{5}(-\d{4})?$/.test(z);
export function slugify(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'item';
}
export function dollarsToCents(v) {
  const n = Number(String(v ?? '').replace(/[$,\s]/g, ''));
  if (!Number.isFinite(n) || n < 0 || n > 100000) return null;
  return Math.round(n * 100);
}

// ---- ids / tokens ----
const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function code(n = 6) {
  const b = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(b, (x) => ALPH[x % ALPH.length]).join('');
}
export function token(bytes = 24) {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export async function sha256Hex(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
export const nowIso = () => new Date().toISOString();
export const money = (c) => '$' + (Number(c || 0) / 100).toFixed(2);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function clientIp(request) {
  return request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';
}

// Fixed-window rate limit stored in D1. Returns true when allowed.
export async function rateLimit(env, key, limit, windowSec) {
  const now = Math.floor(Date.now() / 1000), win = now - (now % windowSec);
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (k, win, n) VALUES (?, ?, 1)
     ON CONFLICT(k) DO UPDATE SET n = CASE WHEN rate_limits.win = excluded.win THEN rate_limits.n + 1 ELSE 1 END,
                                   win = excluded.win
     RETURNING n`).bind(key, win).first();
  return (row?.n || 1) <= limit;
}
export async function limitOr429(env, request, name, limit, windowSec) {
  const ok = await rateLimit(env, `${name}:${clientIp(request)}`, limit, windowSec);
  if (!ok) fail(429, 'Too many requests. Please wait a minute and try again.');
}

export async function log(env, level, msg, detail) {
  console[level === 'error' ? 'error' : 'log'](`[${level}] ${msg}`, detail || '');
  try {
    await env.DB.prepare('INSERT INTO app_log (level, msg, detail, at) VALUES (?, ?, ?, ?)')
      .bind(level, String(msg).slice(0, 300), detail ? JSON.stringify(detail).slice(0, 2000) : null, nowIso()).run();
  } catch { /* logging must never break a request */ }
  // Problems also go to BDT (customer details are removed there).
  if (level === 'error' || level === 'warn') {
    try { const b = await import('./bdt.js'); const i = b.issueFromLog(level, msg, detail); if (i) await b.recordIssue(env, i); } catch { /* never break */ }
  }
}

export function siteUrl(request, env) {
  if (env.SITE_URL) return env.SITE_URL.replace(/\/$/, '');
  const u = new URL(request.url); return `${u.protocol}//${u.host}`;
}
