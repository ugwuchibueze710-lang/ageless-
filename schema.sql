-- Ageless orders (Cloudflare D1)
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, phone TEXT NOT NULL, email TEXT,
  method TEXT NOT NULL, street TEXT, city TEXT, zip TEXT,
  notes TEXT, items TEXT NOT NULL, total REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'new', created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
