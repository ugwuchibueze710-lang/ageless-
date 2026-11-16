# Ageless — Eastland Mall, Evansville IN

Online store for Ageless (anime, plush and collectibles), on Cloudflare Pages with Pages Functions, a D1 database and Square payments.

## How it fits together
- **Storefront** — `index.html`, `assets/` (neon hero, live shop, cart, checkout). `order.html` is the customer's order page; `substitute.html` is where a customer approves or declines a replacement item.
- **Admin** — `/admin/` (orders, products with phone-camera photos, quantities, categories, settings, Square connection, staff invites and activity, emails).
- **API** — `functions/api/[[path]].js`, helpers in `functions/_lib/`. The database tables are created and upgraded automatically on first request (`functions/_lib/db.js`).
- **Payments** — Square OAuth. The store owner clicks **Connect Square** in Settings and signs in to *his own* Square account; payments go straight to that account. The developer app only holds the API keys.

## Cloudflare settings (Pages → ageless → Settings → Variables and secrets, all type *Secret*)
| Name | What it is |
|---|---|
| `ADMIN_SETUP_KEY` | One-time key to create the owner account at `/admin/` |
| `TOKEN_KEY` | Random string used to encrypt Square tokens (never change it after connecting Square) |
| `SQUARE_APP_ID` / `SQUARE_APP_SECRET` | From the Square Developer app (OAuth page) |
| `SQUARE_ENV` | `sandbox` while testing, `production` when live |
| `SQUARE_WEBHOOK_SIGNATURE_KEY` | From the Square webhook subscription (URL `https://<site>/api/square/webhook`) |
| `RESEND_API_KEY`, `EMAIL_FROM` | Optional — sends customer emails. Without them, emails are kept in Admin → Emails. |

D1 binding `DB` is set in `wrangler.toml`.

## Adding products by code
`scripts/import-products.mjs` adds products (with photos, prices and quantities) through the same admin API — see the comment at the top of the file.

Website by Black Daddy Tech.
