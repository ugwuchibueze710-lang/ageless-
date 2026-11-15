// Cloudflare Pages Function — POST /api/orders saves an order into D1 (binding name: DB).
const PRICES = {"ear-hat":19.99,"lavender-bear":25,"blue-plush":20,"yellow-duck":19.99,"mini-plush":15,"rainbow-plush":20,"spooky-bunny":25,"figures":49.99,"keychains":10,"shoe-charms":3,"paw-squishy":9.99};
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });
const clean = (v, n = 200) => String(v ?? "").trim().slice(0, n);

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ error: "Database not connected yet" }, 503);
  let b; try { b = await request.json(); } catch { return json({ error: "Bad request" }, 400); }
  const name = clean(b?.customer?.name, 120), phone = clean(b?.customer?.phone, 40), email = clean(b?.customer?.email, 160);
  const method = b?.method === "delivery" ? "delivery" : "pickup";
  if (!name || !phone) return json({ error: "Name and phone are required" }, 400);
  const addr = method === "delivery" ? { street: clean(b?.address?.street), city: clean(b?.address?.city, 80), zip: clean(b?.address?.zip, 12) } : null;
  if (addr && (!addr.street || !addr.city || !addr.zip)) return json({ error: "Delivery address is incomplete" }, 400);
  const items = (Array.isArray(b?.items) ? b.items : []).slice(0, 50)
    .filter(i => PRICES[i?.id] != null)
    .map(i => ({ id: i.id, name: clean(i.name, 80), qty: Math.max(1, Math.min(99, parseInt(i.qty) || 1)), price: PRICES[i.id], img: clean(i.img, 120) }));
  if (!items.length) return json({ error: "Cart is empty" }, 400);
  const total = Math.round(items.reduce((t, i) => t + i.price * i.qty, 0) * 100) / 100;
  const r = await env.DB.prepare(
    "INSERT INTO orders (name, phone, email, method, street, city, zip, notes, items, total, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?, 'new', datetime('now')) RETURNING id"
  ).bind(name, phone, email, method, addr?.street ?? null, addr?.city ?? null, addr?.zip ?? null, clean(b?.notes, 500), JSON.stringify(items), total).first();
  return json({ ok: true, id: r.id, total });
}
