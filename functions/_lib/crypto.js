// AES-GCM encryption for Square tokens at rest. Key = env.TOKEN_KEY (any long random string).
import { fail } from './util.js';

async function key(env) {
  if (!env.TOKEN_KEY || env.TOKEN_KEY.length < 24) fail(500, 'Server is missing TOKEN_KEY secret.');
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(env.TOKEN_KEY));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function encrypt(env, plain) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(env), new TextEncoder().encode(plain));
  const out = new Uint8Array(12 + ct.byteLength); out.set(iv); out.set(new Uint8Array(ct), 12);
  return btoa(String.fromCharCode(...out));
}
export async function decrypt(env, b64) {
  const buf = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.slice(0, 12) }, await key(env), buf.slice(12));
  return new TextDecoder().decode(pt);
}
