# Trax Production Status — Specification

Internal web app for TraxNYC. Office staff set a **production status on each product of a
Shopify order**; every change records **who** changed it and **when**; any AI agent
(Claude, Maks's assistant, anything that can do HTTP) can **read** an order's status and
its staleness without logging in; Claude can **write** either through this app's API or
directly to Shopify (the data lives on the Shopify order, not in this app).

This document is the single source of truth for the build. Keep it in sync with the code.

## 1. Why

- The existing "Production Status by Product" block lives inside a private Shopify admin app
  (Production Tag). Its data is invisible to the API, so no AI can read it and Claude cannot
  change it from the cloud.
- Maks (sales) emails production every day to ask where orders are. With this app, Maks's AI
  checks `GET /api/stale` first and only chases orders that nobody has touched for N days.
- Goal: less work for every person in the office. One place, one truth, readable by machines.

## 2. Non-goals (v1)

- Not a replacement for the Trax Production App (pieces, castings, invoices). This is the
  order-level status the office and sales use.
- No customer-facing pages, no emails, no notifications (Flow/Zapier/agents can do that from
  the data).
- No Shopify OAuth / embedded admin app. Plain web app with its own staff login.
- No import of the old block's history (not accessible).

## 3. Stack

- Next.js 15 (App Router, route handlers), React 19, TypeScript `strict`, Node 22.
- No database. Shopify order metafields are the store of record. Settings (status list, staff
  roster) live in a **shop** metafield.
- Shopify Admin GraphQL via `fetch` (no SDK). Version from `SHOPIFY_API_VERSION`, default
  `2026-07`.
- Styling: one global stylesheet + CSS modules. No Tailwind, no component library.
- Tests: Vitest (unit, pure logic) + Playwright e2e (`@playwright/test@1.63.0` — matches the
  pre-installed Chromium at `/opt/pw-browsers`; set `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`
  or `executablePath: '/opt/pw-browsers/chromium'` if the browser isn't found) against
  `next start` with a **mock Shopify Admin GraphQL server** (small Node http server that
  dispatches on operation name and keeps state in memory). Never hit the real store in tests.
- Deploy targets: Vercel (first-class) and any Docker host (`output: 'standalone'`, Dockerfile).

## 4. Data model (in Shopify)

Namespace `trax_production`. The namespace already has order definitions `job`, `due_date`,
`design_image` owned by another tool — do not touch those keys.

### 4.1 ORDER metafields (written together in one `metafieldsSet`)

| key               | type                     | content |
|-------------------|--------------------------|---------|
| `item_status`     | `json`                   | per-line-item status + history, see below |
| `last_updated_at` | `date_time`              | max `updated_at` over items (UTC ISO 8601) |
| `last_updated_by` | `single_line_text_field` | the `updated_by` of that latest change |
| `summary`         | `single_line_text_field` | e.g. `CAD ×2 · Setting ×1 — Ahmed, Oct 27` (≤ 200 chars) |

`item_status` value:

```json
{
  "v": 1,
  "items": {
    "50788056399960": {
      "title": "14K Gold 20 Pt Lab Diamond Tennis Bracelet 71679",
      "status": "CAD",
      "updated_at": "2026-10-27T15:12:03Z",
      "updated_by": "Ahmed",
      "source": "web",
      "history": [
        { "status": "CAD", "at": "2026-10-27T15:12:03Z", "by": "Ahmed", "source": "web", "note": "" }
      ]
    }
  }
}
```

- Keys are the **numeric line item id** as a string (`gid://shopify/LineItem/50788056399960` → `"50788056399960"`).
- `source` ∈ `web` (staff UI) · `api` (bearer token) · `claude` (direct Shopify write) · `import`.
- `history` is append-only, oldest first, capped at 100 entries (drop oldest).
- Setting `status` to `null` removes the item entry (keeps nothing). Record this in the
  order's summary only.
- Items whose title matches `settings.hide_items_matching` (case-insensitive substring,
  e.g. warranties, shipping protection) are hidden from the UI and never tracked.

### 4.2 Order tag

- On the first status write: add tag `trax-production`. (The tag `in-production` already
  exists on older orders from another process — never use, add or remove it.)
- When **every tracked item** has a status flagged `done` in settings: remove the tag.
- If a later write sets a non-done status again: add the tag back.
- Use `tagsAdd` / `tagsRemove` (never rewrite the whole tag list — other apps own tags there).

### 4.3 SHOP metafield `trax_production.settings` (`json`)

```json
{
  "v": 1,
  "statuses": [
    { "name": "CAD" }, { "name": "Assembling" }, { "name": "Mold" }, { "name": "Polishing" },
    { "name": "Polishing Erik" }, { "name": "Polishing Maria" }, { "name": "Casting" },
    { "name": "Engraving" }, { "name": "Final Polishing" }, { "name": "Cleaning Casting" },
    { "name": "Resizing" }, { "name": "Setting" }, { "name": "Setting Azavedo" },
    { "name": "Setting Igor" }, { "name": "Setting Jorje" }, { "name": "Waiting for DIA" },
    { "name": "Sent to Store", "done": true }, { "name": "Sent to Shipping Dept", "done": true },
    { "name": "Waiting for Chain" }
  ],
  "stale_after_days": 3,
  "hide_items_matching": ["warranty", "shipping protection"],
  "staff": [
    { "name": "Ahmed", "pin_hash": "…", "active": true }
  ]
}
```

- Status order above is the dropdown order (it is the order from the existing block). The list
  will grow; new statuses are added from `/admin` or by Claude editing this metafield.
- The app caches settings in memory for 30 s. If the metafield is missing, the app uses these
  defaults (statuses, 3 days, hide patterns, empty staff) and `/admin` can write it.
- `pin_hash = sha256(PIN_PEPPER + ":" + name.toLowerCase() + ":" + pin)` hex. `PIN_PEPPER` is a
  server env secret, so the hashes stored in Shopify are useless without it.

### 4.4 Read-only context from other metafields (shown, never written)

- `custom.production_date` — "Ships by Fri, Oct 30 (Akshata, Oct 22)" style text.
- `custom.custody` — who physically has the piece (last scan).
- `custom.give_to`.
Show these on the order page and include them in the API under `context`.

### 4.5 Concurrency

Read → modify → `metafieldsSet` with `compareDigest` taken from the read. On a digest
mismatch (userErrors), re-read and retry up to 3 times, then return 409.

## 5. Auth

- **Staff (web)**: `/login` → pick your name from the roster → enter PIN → server verifies →
  HttpOnly, SameSite=Lax, Secure (in prod) cookie `trax_staff` holding an HMAC-SHA256-signed
  payload `{ name, exp }` (30 days) signed with `SESSION_SECRET`. `/logout` clears it.
  Rate-limit PIN attempts: 10 per minute per IP+name (in-memory; fine on serverless).
- **API writes**: `Authorization: Bearer <token>`. `API_TOKENS="claude:abc…,maks-ai:def…"`
  (label:token pairs). `updated_by` = body `by` if given, else the token label.
  Compare tokens with a constant-time compare.
- **Reads**: public by default. If `READ_TOKEN` is set, `/api/*` requires it (bearer header or
  `?token=`), and HTML pages require either a staff cookie or `?token=`.
- `/admin` requires `ADMIN_PASSCODE` (form → signed cookie `trax_admin`, 12 h).

## 6. Pages

- `/` — Order search box (accepts `251548`, `#251548`, `Order 251548`) → `/orders/251548`.
  Below: **In production** list — orders tagged `trax-production`, stalest first. Row: order #,
  item count, summary, "Last updated 3 days ago by Ahmed", red "stale" badge when
  `days_since_update ≥ stale_after_days`. Cursor pagination (50/page).
- `/orders/[number]` — the screen that mirrors the existing block:
  - Header: `Order #251548`, link to Shopify admin
    (`https://admin.shopify.com/store/<handle>/orders/<numericId>`), created date, context
    fields (ships-by, custody, give-to) if present, and **Last updated … by …** for the order.
  - Card titled **Production Status by Product**. For each visible item: black pill with the
    product title, a full-width `<select>` ("Select production status…" + statuses), and
    under it a muted line **Last updated Oct 27, 3:12 PM by Ahmed** (or "Not set yet").
    A small "History" disclosure lists the entries newest first.
  - Changing the select saves immediately (optimistic, shows "Saving…/Saved", rolls back and
    shows the error on failure). If not logged in, selects are disabled with a "Log in to
    update" link.
  - Hidden items are collapsed: "2 non-production items hidden".
  - A line item that no longer exists on the order (order edit) still shows its stored
    entry, labelled "(removed from order)".
- `/login`, `/logout`.
- `/admin` — statuses (add, rename label, reorder, toggle done), stale days, hide patterns,
  staff roster (add, set/reset PIN, deactivate). Renaming a status does not rewrite history.
- `/agents` (HTML) and `/llms.txt` (text/plain) — how AI agents use this: base URL,
  endpoints, examples with `curl`, the meaning of `stale`, how to write with a bearer token.

Times are stored in UTC and displayed in `America/New_York`. Relative times ("3 days ago")
and absolute ("Oct 27, 3:12 PM").

## 7. API

All JSON. Errors: `{ "error": "message" }` with 400/401/404/409/502.

- `GET /api/orders/{number}` →
  ```json
  {
    "order": { "number": "251548", "id": "gid://shopify/Order/18936388255832",
               "created_at": "…", "admin_url": "…", "tags": ["…"] },
    "context": { "production_date": "…", "custody": "…", "give_to": "…" },
    "last_updated_at": "…", "last_updated_by": "Ahmed",
    "days_since_update": 3.2, "stale": true, "stale_after_days": 3, "all_done": false,
    "items": [ { "line_item_id": "50788056399960", "title": "…", "quantity": 1,
                 "status": "CAD", "done": false, "updated_at": "…", "updated_by": "Ahmed",
                 "source": "web", "history": [ … ] } ],
    "untracked_items": [ { "line_item_id": "…", "title": "…" } ],
    "hidden_items":    [ { "line_item_id": "…", "title": "1-Month Silver Warranty" } ]
  }
  ```
  `days_since_update` / `stale` are `null` / `false` when nothing was ever set.
- `GET /api/orders` → orders tagged `trax-production` (no history), `?cursor=` pagination,
  `?stale=1` filter. Sorted stalest first.
- `GET /api/stale?days=3` → same shape as `/api/orders?stale=1` with `days` override; includes
  `count`, `days`, `checked_at`.
- `GET /api/statuses` → `{ statuses: [{name, done}], stale_after_days }`.
- `POST /api/orders/{number}/items/{lineItemId}` body `{ "status": "Setting" | null,
  "by"?: "…", "note"?: "…" }` → updated item + order summary. 400 if status unknown.
- `POST /api/orders/{number}` body `{ "items": { "<lineItemId>": "Status" | null }, "by"?,
  "note"? }` → bulk, one Shopify write.
- `GET /api/health` → `{ ok: true, shop: "…", api_version: "…" }` (no secrets).

Orders older than 60 days are only visible if the Shopify token has `read_all_orders`.

## 8. Shopify client

- `shopifyGraphQL<T>(query, variables)` → POST
  `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/graphql.json` with
  `X-Shopify-Access-Token`. Retries 429/5xx and `THROTTLED` with backoff, 3 attempts. GraphQL
  `errors` and `userErrors` become thrown errors with readable messages.
- Operations (keep each in `src/lib/shopify/queries.ts` as named documents so they can be
  validated against the schema): `OrderByName`, `InProductionOrders`, `SetOrderStatus`
  (`metafieldsSet`), `AddTags`, `RemoveTags`, `ShopSettings`, `SetShopSettings`.
- Order lookup: `orders(first: 1, query: "name:#251548")`, fields: `id name createdAt tags
  lineItems(first: 100) { id title quantity sku variant { id } product { id } }`,
  `metafield(namespace:"trax_production", key:"item_status") { value compareDigest }`, plus the
  `custom.*` context metafields.
- In-production list: `orders(first: 50, query: "tag:trax-production", sortKey: UPDATED_AT,
  reverse: true, after: $cursor)` with the four `trax_production` metafields. Sort client-side
  by `last_updated_at` ascending for "stalest first".

## 9. Environment

```
SHOPIFY_STORE_DOMAIN=05nbj6-yr.myshopify.com # the myshopify domain (traxnyc.com is the storefront)
SHOPIFY_ADMIN_TOKEN=shpat_…                  # custom app: read_orders, write_orders, read_all_orders, read_products
SHOPIFY_API_VERSION=2026-07
SHOPIFY_API_URL=                             # test-only override: full URL to …/graphql.json (the mock server)
SHOPIFY_ADMIN_HANDLE=05nbj6-yr               # for admin.shopify.com/store/05nbj6-yr/orders/<id> links
SESSION_SECRET=<32+ random bytes, hex>
PIN_PEPPER=<32+ random bytes, hex>
ADMIN_PASSCODE=<passcode for /admin>
API_TOKENS=claude:<random>,maks-ai:<random>  # optional; label:token pairs
READ_TOKEN=                                  # optional; empty = public reads
DISPLAY_TZ=America/New_York
```

`.env.example` lists all of them with comments. Nothing secret is committed.

## 10. Repo layout

```
SPEC.md, README.md, CLAUDE.md (how Claude reads/writes statuses directly via Shopify)
docs/AGENTS.md (same content as /agents, for humans setting up an agent)
src/app/…  (pages + route handlers)   src/lib/… (shopify client, status logic, auth, settings)
src/components/…  tests/unit/…  tests/e2e/…  tests/mock-shopify/… scripts/setup-shopify.ts
Dockerfile, .dockerignore, .env.example, .gitignore, package.json, next.config.ts, tsconfig.json
```

- `scripts/setup-shopify.ts` — idempotent: creates the four order metafield definitions and
  the shop settings metafield (if missing) using the env token. `npm run setup:shopify`.

## 11. Quality bar (all must pass before the build is "done")

- `npm run lint`, `npm run typecheck`, `npm run build`, `npm test` (Vitest), `npm run e2e`
  (Playwright against the mock Shopify server) — all green, run from a clean install.
- Unit tests cover: status merge + history cap, done/tag transitions, stale math (incl. never
  updated), PIN hash/verify, cookie sign/verify + expiry, token parsing + constant-time compare,
  order-number parsing, hide patterns, summary string.
- e2e covers: home search → order page; login with PIN; change a status → "Last updated … by
  …" appears and the mock store received `metafieldsSet` + `tagsAdd`; set every item done →
  `tagsRemove`; `/api/orders/{n}` and `/api/stale` JSON shapes; write without auth → 401;
  mobile viewport (390 px) renders without horizontal scroll.
- Every GraphQL document validated against the Admin schema (use the Shopify MCP
  `validate_graphql_codeblocks` tool when available).
- README: Vercel deploy + custom domain, Shopify custom-app token steps (scopes above),
  env table, how staff log in, how agents read, how Claude writes.

## 12. Look

Mirror the two screenshots in `docs/reference/` (copied from the existing block):
white card, 16 px radius, light border/shadow; title "Production Status by Product" 17 px
medium; product pill: `#1f1f1f` background, white 15 px text, fully rounded, 12 × 24 px
padding; select: full width, 56 px tall, 1 px `#c9cccf` border, 12 px radius, 16 px text,
up/down chevron at the right. Under each select a 13 px muted "Last updated …" line. Phone
first (staff use phones on the floor), 16 px gutters, no horizontal scroll. Light theme only.
