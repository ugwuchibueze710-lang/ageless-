# Ageless — Eastland Mall, Evansville IN

Static site plus a Cloudflare Pages Function for orders.

- Front end: `index.html`, `assets/`
- Orders API: `functions/api/orders.js`, a POST to `/api/orders` that writes to the D1 database bound as `DB`
- Database tables: `schema.sql`

Product photos are cut from the store's own photos. Prices marked `confirmed:false` in `assets/products.js` are placeholders the owner still needs to confirm.

Website by Black Daddy Tech.
