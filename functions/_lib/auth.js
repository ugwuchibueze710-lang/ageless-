// Staff authentication: PBKDF2 password hashes, HttpOnly session cookies, roles.
import { fail, token, sha256Hex, timingSafeEqual, nowIso, clientIp } from './util.js';

// What each permission allows. Owners have all of them.
export const PERMS = {
  orders: 'See and update orders, customers, substitutions and emails',
  refunds: 'Refund and cancel orders through Square',
  products: 'Add, edit, hide and delete products, photos and categories',
  stock: 'Change quantities',
  sales: 'See sales totals on the home screen',
  settings: 'Change settings, shipping and the Square connection',
  staff: 'Invite and manage staff, and see their activity',
};
export function permsOf(st) { if (st.role === 'owner') return Object.keys(PERMS); try { return JSON.parse(st.perms || '[]').filter((p) => p in PERMS); } catch { return []; } }
export function cleanPerms(list) { return [...new Set((Array.isArray(list) ? list : []).filter((p) => p in PERMS))]; }


const ITER = 100000;
const COOKIE = 'ag_admin';
const SESSION_HOURS = 12;

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(password, salt, iter) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256);
}
export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITER}$${b64(salt)}$${b64(await derive(password, salt, ITER))}`;
}
export async function verifyPassword(password, stored) {
  const [alg, iter, salt, hash] = String(stored || '').split('$');
  if (alg !== 'pbkdf2') return false;
  const got = b64(await derive(password, unb64(salt), Number(iter)));
  return timingSafeEqual(got, hash);
}
export function passwordProblem(p) {
  if (typeof p !== 'string' || p.length < 10) return 'Password must be at least 10 characters.';
  if (p.length > 200) return 'Password is too long.';
  return null;
}

export async function createSession(env, staffId, request) {
  const t = token(32), h = await sha256Hex(t);
  const exp = new Date(Date.now() + SESSION_HOURS * 3600e3).toISOString();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(nowIso()),
    env.DB.prepare('INSERT INTO sessions (token_hash, staff_id, expires_at, created_at, last_seen, ip) VALUES (?, ?, ?, ?, ?, ?)').bind(h, staffId, exp, nowIso(), nowIso(), request ? clientIp(request) : null),
    env.DB.prepare('UPDATE staff SET last_login = ? WHERE id = ?').bind(nowIso(), staffId),
  ]);
  return `${COOKIE}=${t}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}`;
}
export function clearCookie() { return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`; }

function readCookie(request) {
  const c = request.headers.get('cookie') || '';
  const m = c.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return m ? m[1] : null;
}
export async function destroySession(env, request) {
  const t = readCookie(request); if (!t) return null;
  const h = await sha256Hex(t);
  const s = await env.DB.prepare('SELECT st.id, st.email FROM sessions se JOIN staff st ON st.id = se.staff_id WHERE se.token_hash = ?').bind(h).first();
  await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(h).run();
  return s;
}

// Returns the logged-in staff member or throws 401/403.
// State-changing admin calls must also send X-Ageless-Admin: 1 (blocks cross-site form posts).
export async function requireStaff(env, request, perm) {
  const t = readCookie(request);
  if (!t) fail(401, 'Please log in.');
  const h = await sha256Hex(t), now = nowIso();
  const s = await env.DB.prepare(`SELECT st.id, st.email, st.name, st.role, st.perms, se.last_seen FROM sessions se JOIN staff st ON st.id = se.staff_id
     WHERE se.token_hash = ? AND se.expires_at > ? AND st.active = 1`).bind(h, now).first();
  if (!s) fail(401, 'Your session ended. Please log in again.');
  if (request.method !== 'GET' && request.headers.get('x-ageless-admin') !== '1') fail(403, 'Blocked request.');
  s.perms = permsOf(s);
  request.__staff = s;
  if (!s.last_seen || Date.parse(s.last_seen) < Date.now() - 60e3) await env.DB.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?').bind(now, h).run();
  delete s.last_seen;
  if (perm === 'owner' && s.role !== 'owner') fail(403, 'Only an owner can do this.');
  if (perm && perm !== 'owner' && !s.perms.includes(perm)) fail(403, `You don't have permission for this (${PERMS[perm] ? PERMS[perm].toLowerCase() : perm}). Ask the owner.`);
  return s;
}
