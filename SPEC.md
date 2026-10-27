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
  checks `GET /api/orders/{number}` (one order) or `GET /api/stale` (every open production
  order nobody has touched for N business days — including orders nobody has ever set a
  status on) first and only chases those.
- Goal: less work for every person in the office. One place, one truth, readable by machines.

## 2. Non-goals (v1)

- Not a replacement for the Trax Production App (pieces, castings, invoices). This is the
  order-level status the office and sales use.
- No customer-facing pages, no emails, no notifications (Flow/Zapier/agents can do that from
  the data).
- No Shopify OAuth install flow / embedded admin app. Plain web app with its own staff login.
  (The client-credentials token exchange in §8 is one server-to-server POST, not an install
  flow.)
- No import of the old block's history (not accessible).
- No scheduled jobs (cron, sweeps): list queries filter closed/cancelled/shipped orders out
  instead, and derived data is repaired on read (§4.6).
- No parsing of free-text metafields (`custom.production_date` is shown raw).

## 3. Stack

- Next.js 15 (≥ 15.2.3 — earlier 15.x has the middleware auth bypass CVE-2025-29927; keep on
  the latest 15.x), App Router, route handlers, React 19, TypeScript `strict`, Node 22.
- No database. Shopify order metafields are the store of record. Settings (status list) and
  the staff roster live in two **shop** metafields.
- Shopify Admin GraphQL via `fetch` (no SDK). Version from `SHOPIFY_API_VERSION`, default
  `2026-10` (latest stable as of Oct 2026, supported until Oct 2027; `2026-07` is supported
  until July 16, 2027; `2025-10` is retired — a retired version silently falls forward, which
  `/api/health` exposes as `served_api_version`).
- Styling: one global stylesheet + CSS modules. No Tailwind, no component library.
- Tests: Vitest (unit, pure logic) + Playwright e2e (`@playwright/test@1.63.0` — matches the
  pre-installed Chromium at `/opt/pw-browsers`; set `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`
  or `executablePath: '/opt/pw-browsers/chromium'` if the browser isn't found) against
  `next start` with a **mock Shopify Admin GraphQL server** (small Node http server that
  dispatches on operation name and keeps state in memory). The Playwright config sets
  `SHOPIFY_API_URL` (the mock) and `SHOPIFY_ADMIN_TOKEN=test_e2e` explicitly. Never hit the
  real store in tests. Ports: `PORT` (app, 3000), `MOCK_SHOPIFY_PORT` (4001) and
  `NO_ADMIN_PORT` (the passcode-less app copy; default `PORT+1`, or `PORT+2` when that is the
  mock's port) — resolved once in `tests/e2e/ports.ts`, which refuses a collision.
- Dependencies: `npm run audit:prod` (`scripts/audit.mjs`) runs `npm audit --omit=dev` against
  an explicit allow-list. Accepted: the four `postcss <= 8.5.22` advisories Next 15.x pulls in
  (build-time handling of the app's own CSS; fixed from Next 16.3 — drop them with the 15.x pin).
- Deploy targets: Vercel (first-class) and any Docker host (`output: 'standalone'`, Dockerfile).

## 4. Data model (in Shopify)

Namespace `trax_production`. The namespace already has order definitions `job` (json),
`due_date` (date), `design_image` (file_reference) owned by another tool — do not touch those
keys (`due_date` is read, §4.4). Every definition in this merchant-owned namespace has admin
access `PUBLIC_READ_WRITE`, which is what lets Claude's separate MCP app write the same
metafields.

### 4.1 ORDER metafields (written together in one `metafieldsSet`)

| key               | type                     | content |
|-------------------|--------------------------|---------|
| `item_status`     | `json`                   | per-line-item status + history, see below. **Authoritative** — everything else is derived from it (§4.6) |
| `last_updated_at` | `date_time`              | most recent `updated_at` over items (display only; staleness uses `stale_since`, §7), formatted `YYYY-MM-DDTHH:MM:SSZ` — UTC, seconds, no milliseconds, e.g. `2026-10-27T15:12:03Z`. The same format is used for every `at` / `updated_at` inside `item_status` |
| `last_updated_by` | `single_line_text_field` | the `updated_by` of that latest change |
| `summary`         | `single_line_text_field` | e.g. `0/2 done · CAD ×1 · Setting Igor ×1 — Ahmed, Oct 27` (≤ 200 chars, format below) |

`item_status` value:

```json
{
  "v": 1,
  "visible_ids": ["50788056399960", "50788056432728"],
  "items": {
    "50788056399960": {
      "title": "14K Gold 20 Pt Lab Diamond Tennis Bracelet 71679",
      "status": "cad",
      "updated_at": "2026-10-27T15:12:03Z",
      "updated_by": "Ahmed",
      "source": "web",
      "via": "web:Ahmed",
      "history": [
        { "kind": "set", "status": "cad", "at": "2026-10-27T15:12:03Z", "by": "Ahmed",
          "source": "web", "via": "web:Ahmed", "note": "" }
      ]
    }
  }
}
```

- Keys are the **numeric line item id** as a string (`gid://shopify/LineItem/50788056399960` → `"50788056399960"`).
- `status` is a status **id** from settings (§4.3), e.g. `setting_igor`, or `null`.
- `visible_ids` = ids of the visible, non-removed line items as of the last write. The list
  query cannot fetch line items (§8), so list rows use it to count untracked items; the
  single-order read refreshes it after an order edit (§4.6). When it is missing (older or
  partial direct write) list rows fall back to `currentSubtotalLineItemsQuantity` for
  `item_count` and report `untracked_count: null` until the next single-order read repairs it.
  A never-set order has no `item_status` at all, so its list row uses the same fallback for
  good: `item_count` and `open_items` are the Shopify quantity (hidden lines included) and
  `untracked_count` is `null`; the home page shows such rows as `N lines`, never `0/N items`.
- `source` ∈ `web` (staff cookie) · `api` (bearer token) · `claude` (direct Shopify write) ·
  `import`. The server sets it from the credential; it is never read from the request body.
- `via` = `web:<staff name>` · `token:<token label>` · `claude`; shown when it differs from `by`.
- `history` is append-only, oldest first, capped at **30 entries per item** (drop oldest).
  `kind` ∈ `set` (status changed) · `confirm` (the current status written again = "still here,
  checked today") · `clear` (status set to `null`). `note` is trimmed to 200 characters.
- Size guard: Shopify caps `json` metafields at 128 KB (64 KB for other types). Before
  `metafieldsSet`, if the minified `item_status` exceeds 100,000 bytes, drop the oldest history
  entries across items (round-robin) until it fits; if it still does not fit, return 413
  `item_status_too_large`.
- Setting `status` to `null` **keeps the entry**: `status: null`, bumps `updated_at` /
  `updated_by`, appends `{ "kind": "clear", "status": null, … }`. The item renders as
  "Not set (cleared by Ahmed, Oct 27)" and counts as not done. Entries are never deleted
  through the API.
- Writing an item's current status again is a **confirmation**: appends `{ "kind": "confirm",
  … }`, bumps `updated_at` / `updated_by`, tags unchanged.
- **Hidden** = `requiresShipping == false`, or `isGiftCard`, or the title matches
  `settings.hide_items_matching` (case-insensitive literal substring, never regex). Hidden
  items are collapsed in the UI and never tracked; a write to one → 400 `item_hidden`.
  (Verified on #251548: "1-Month Silver Warranty" and "Shipping Protection" both have
  `requiresShipping: false`.)
- **Removed** = `currentQuantity == 0` (order edit — Shopify keeps the line with its original
  `quantity`). A removed item keeps its stored entry, is excluded from the done/stale logic, is
  shown read-only, and a write to it → 400 `item_removed`. An id in `item_status` that is
  missing from `lineItems` entirely is treated the same way.
- **Open item** = visible, not removed, and its status is not flagged `done` (no entry, or
  `status: null`, counts as open).
- On read, `item_status` is **untrusted** (Claude and other tools write it too): validate it
  against a schema (`v == 1`, item keys `^\d{1,20}$`, known fields, timestamps in the format
  above, status ids as strings). A malformed or unknown-version value is treated as empty,
  logged, and surfaced on the order page as "Status data unreadable — contact admin"; the next
  write starts from empty `items`. Items are kept in a null-prototype object or `Map` (no
  `__proto__` keys).
- `summary` = `{done}/{visible} done · ` + groups `{status name} ×{n}` for open items in
  dropdown order, then `Not set ×{n}` for open items without a status (no entry or `status:
  null`), joined with ` · `, + ` — {by}, {Mon D}` (America/New_York; year appended when not
  the current year), e.g. `0/2 done · CAD ×1 · Not set ×1 — Ahmed, Oct 27`. Over 200 chars:
  drop groups from the end and append ` +{k} more`. Nothing set: `No status yet`.

### 4.2 Order tag

- Tag `trax-production` is **owned by this app** (and by Claude following `CLAUDE.md`);
  nothing else may write it. The tag `in-production` already exists on four closed/cancelled
  2025 orders from another process — never use, add or remove it.
- On the first status write (any non-done status): `tagsAdd`.
- When **every visible item** (not hidden, `currentQuantity > 0`) has an entry whose status is
  flagged `done` in settings: `tagsRemove`. A visible item with no entry or `status: null`
  counts as not done.
- If a later write sets a non-done status again: `tagsAdd`.
- Use `tagsAdd(id: ID!, tags: [String!]!)` / `tagsRemove` (10 cost points each); never rewrite
  the whole tag list — other apps own tags there.
- Order of operations: `metafieldsSet` first, then the tag mutation. A tag failure is logged
  and returned as `tag_synced: false`; it does not roll back the status.
- Reconciliation: every read of a single order (`GET /api/orders/{n}`, the order page)
  recomputes the tag from `item_status` (§4.6) and fixes it if it differs. Changing a status's
  `done` flag in `/admin` does not touch tags immediately; the next read of each order does.
- The tag is only ever derived from **entries**. When `item_status` has none — missing,
  `items: {}`, or unreadable (§4.1) — nothing can be derived and the tag is left exactly as it
  is: a tagged never-set order stays in the lists and in `/api/stale` (`stale_reason:
  never_set`) until someone sets a status. Writes always leave entries behind, so every write
  decides the tag; reads of entry-less orders never issue `tagsAdd` or `tagsRemove`.
- Closed (archived) and cancelled orders keep whatever tag they have: every list query adds
  `status:open`, so they drop out of the lists on their own (verified: `status:open` excludes
  both archived and cancelled orders; `-status:cancelled` alone does not exclude archived ones).

### 4.3 SHOP metafields `trax_production.settings` and `trax_production.staff` (both `json`)

Two metafields, so that a status-list edit can never touch PIN hashes. Each is read with
`compareDigest` and written with CAS (§4.5). `ownerId` for writes = `shop { id }`
(`gid://shopify/Shop/64243138648`).

`trax_production.settings`:

```json
{
  "v": 1,
  "statuses": [
    { "id": "cad", "name": "CAD" }, { "id": "assembling", "name": "Assembling" },
    { "id": "mold", "name": "Mold" }, { "id": "polishing", "name": "Polishing" },
    { "id": "polishing_erik", "name": "Polishing Erik" }, { "id": "polishing_maria", "name": "Polishing Maria" },
    { "id": "casting", "name": "Casting" }, { "id": "engraving", "name": "Engraving" },
    { "id": "final_polishing", "name": "Final Polishing" }, { "id": "cleaning_casting", "name": "Cleaning Casting" },
    { "id": "resizing", "name": "Resizing" }, { "id": "setting", "name": "Setting" },
    { "id": "setting_azavedo", "name": "Setting Azavedo" }, { "id": "setting_igor", "name": "Setting Igor" },
    { "id": "setting_jorje", "name": "Setting Jorje" },
    { "id": "waiting_for_dia", "name": "Waiting for DIA", "waiting": true },
    { "id": "sent_to_store", "name": "Sent to Store", "done": true },
    { "id": "sent_to_shipping_dept", "name": "Sent to Shipping Dept", "done": true },
    { "id": "waiting_for_chain", "name": "Waiting for Chain", "waiting": true }
  ],
  "stale_after_days": 3,
  "work_days": [1, 2, 3, 4, 5],
  "hide_items_matching": ["warranty", "shipping protection"],
  "watch_query": "tag:custom-item-order status:open fulfillment_status:unshipped",
  "admin_failed_attempts": 0,
  "admin_locked_until": null
}
```

`trax_production.staff`:

```json
{
  "v": 1,
  "staff": [
    { "id": "ahmed", "name": "Ahmed", "pin_hash": "…", "active": true, "session_version": 1,
      "failed_attempts": 0, "locked_until": null }
  ]
}
```

- Status `id` is an immutable slug (made once from the name: lowercase, `[^a-z0-9]+` → `_`);
  items and history store the id. `name` is the label — renaming changes only `name`, so
  history and current items keep working. `done` = finishing status; `waiting` = blocked on
  parts (§7); `retired` = hidden from new selections but still rendered for items that hold it.
  Statuses are never deleted. Order above = dropdown order (it is the order from the existing
  block). The list will grow; new statuses are added from `/admin` or by Claude editing
  `settings` with `compareDigest` (never `staff`).
- `work_days`: ISO weekday numbers (1 = Monday … 7 = Sunday), evaluated in `America/New_York`;
  used for business-day staleness (§7).
- `watch_query`: a Shopify order search string whose matches form the "never set" universe
  (§7); empty string disables it. It is sent as the `$q` variable, never interpolated into a
  document. Tags containing `:` must be quoted inside it (`tag:'Group:Ahmed'` — verified live;
  unquoted returns nothing).
- Caching: both metafields are cached in memory for 30 s; the login handler and `/admin` read
  uncached. If a metafield is missing, the app uses the defaults above (statuses, 3 days,
  Mon–Fri, hide patterns, watch query, empty staff) and `/admin` can write it.
- Validation on every read: shape, `v == 1`, unique status ids and names (≤ 60 chars), unique
  staff ids and names. An invalid value is logged and the defaults are used — never a crash.
  Merchant-owned metafields are readable and editable by every admin user and installed app,
  so nothing beyond PIN hashes may live here; tokens and the pepper stay in env.
- `staff[].name` is a first name or nickname (≤ 30 chars, unique, no surnames); an entry never
  holds emails, phone numbers or other contact details. `id` is a slug of the name at creation
  and never changes, so renaming does not break the PIN.
- `pin_hash = sha256(PIN_PEPPER + ":" + staff.id + ":" + pin)` hex. `PIN_PEPPER` is a server env
  secret, so the hashes stored in Shopify are useless without it.
- `pin_hash`, `session_version`, `failed_attempts`, `locked_until` and the admin lockout fields
  are server-side only: never rendered on `/admin` (the roster shows name, active, "PIN set:
  yes/no", "locked: yes/no") and never returned by any `/api/*` endpoint.
- Both definitions are created with `access: { storefront: NONE }` (§10).

### 4.4 Read-only context from other metafields (shown, never written)

- `custom.production_date` (`single_line_text_field`) — free text such as
  "Ships by Fri, Oct 30 (Akshata, Oct 22)"; shown raw, not parsed.
- `custom.custody` (`multi_line_text_field`, "Who has it (last scan)") — rendered with line
  breaks.
- `custom.give_to` (`single_line_text_field`).
- `trax_production.due_date` (`date`, "Promised completion date", owned by another tool).
Show these on the order page and include them in the API under `context` (credentialed shape
only, §7).

### 4.5 Concurrency

Read `metafield(namespace: "trax_production", key: "item_status") { value compareDigest }`.
In `SetOrderStatus` only the `item_status` entry carries `compareDigest`: the digest from the
read, or JSON `null` sent explicitly (not omitted) when the metafield did not exist yet — that
protects the create race too. `metafieldsSet` is atomic (max 25 entries per call; we send 4),
so the three derived metafields are protected as well. The mutation selects
`metafields { key compareDigest updatedAt } userErrors { field message code }`. On
`code == "STALE_OBJECT"` ("modified since it was loaded"): re-read, re-apply the change and
retry up to 3 times, then 409 `conflict`. `INVALID_COMPARE_DIGEST` is a programming error
(500, no retry). Any other `userError` → 502 `shopify_error` (message in the server log). Keep
the returned `compareDigest` for the response. The same rule applies to the two shop
metafields (`settings`, `staff`).

### 4.6 Source of truth and self-healing

`item_status` is authoritative. `last_updated_at`, `last_updated_by`, `summary`, `visible_ids`
and the `trax-production` tag are derived. One pure function
`derive(itemStatus, lineItems, settings)` produces them; every write uses it, and every read of
a single order (`GET /api/orders/{n}`, the order page) recomputes them and, when Shopify holds
something different (a partial direct write by Claude, a failed tag mutation, a `done` flag
changed in `/admin`, an order edit), rewrites them with `compareDigest` and fixes the tag. The
repair is awaited (serverless functions may freeze after the response), its errors are logged,
and it never fails the read. Reads served from the 15 s public cache (§7) do not repair. An
order whose `item_status` holds no entries (never set, or unreadable) is left untouched by a
read: no metafield write, no tag mutation (§4.2); `tag_synced` is `true` for it.

## 5. Auth

- **Staff (web)**: `/login` → pick your name from the roster (active names only) → enter PIN
  (4–8 digits, `inputmode="numeric"`, `autocomplete="off"`; `/admin` rejects shorter ones) →
  server verifies (`timingSafeEqual` on the two hashes) → cookie `trax_staff`: HttpOnly,
  SameSite=Lax, Path=/, Secure (always, except when `NODE_ENV !== 'production'`; the public URL
  must be HTTPS — Vercel does this, a Docker deploy sits behind a TLS-terminating proxy).
  Value = `base64url(payload).base64url(HMAC-SHA256(SESSION_SECRET, payload))`, payload
  `{ "t": "staff", "id": "ahmed", "name": "Ahmed", "sv": 1, "exp": <unix seconds> }`, 30 days.
  Verification order: parse → `timingSafeEqual` on the signature → `t === "staff"` → `exp` in
  the future → `id` present in the roster with `active: true` and `sv === staff.session_version`
  (the cached roster is fine here). `POST /logout` clears it (a "Log out" form button in the
  header and on the home page; there is no GET — a link would be prefetched by `<Link>` and
  could be triggered cross-site). `/admin` "reset PIN" and "deactivate" increment that
  person's `session_version`, which logs them out everywhere within the 30 s cache window.
  - Lockout is **persisted, not in-memory**: each `staff[]` entry carries `failed_attempts` and
    `locked_until`; after 5 consecutive failures the name is locked for 15 minutes, doubling
    for each further streak (max 24 h); a successful login resets the counter; `/admin` can
    clear a lock. **The attempt is counted before the PIN is verified**: the login handler
    increments `failed_attempts` inside the CAS mutator from the freshly read entry (writes to
    each shop metafield are also serialized per instance), refuses a locked name with 429
    `locked` without verifying anything, and refuses the login (429) when the attempt could not
    be recorded — so N parallel guesses cost N counted attempts and the lock lands on the 5th.
    The PIN is compared only after the claim; on success the counter is reset with a second
    write. The in-memory limiter (10 attempts/min **per name**, so a spoofed IP header cannot
    widen it) stays only as a best-effort throttle — it is per-instance on serverless and is
    not the protection. Client IP for the per-IP limiters follows `TRUST_PROXY` (§9): `vercel`
    → the platform's `x-real-ip` / `x-vercel-forwarded-for`; `1` → the entry the one reverse
    proxy appended to `x-forwarded-for` (the last one); unset → no header is believed and every
    anonymous caller shares one bucket. Every failed login is logged with name and IP. Never
    log PINs, passcodes, tokens, cookie values or `Authorization` headers.
  - `/login?next=<path>` returns to that page after login; `next` must match `^/[^/\\]`
    (same-origin path) or is ignored. A 401 on a save from the order page shows "Session
    expired — log in" with a `/login?next=` link.
- **Writes** (`POST /api/orders/...`): accepted with `Authorization: Bearer <token>` from
  `API_TOKENS="claude:abc…,maks-ai:def…"` (label:token pairs) or with a valid `trax_staff`
  cookie (the web UI). Cookie → `updated_by` is always the cookie's `name`; a `by` field in the
  body → 400. Bearer → `updated_by` = body `by` if given (≤ 60 chars), else the token label. In
  both cases the server records `via` (`web:Ahmed` / `token:maks-ai`) and sets `source`
  (`web` / `api`) — never from the body. Tokens and the passcode are compared with a
  constant-time compare (SHA-256 both sides, then `timingSafeEqual`).
- **Reads**: public by default — meaning the *public shape* (§7). If `READ_TOKEN` is set:
  `/api/*` requires `Authorization: Bearer <READ_TOKEN or any API_TOKENS token>` (no `?token=`
  — URLs leak into logs, browser history and forwarded links), and HTML pages require a
  `trax_staff` cookie. `READ_TOKEN` never authorizes writes.
- **`/admin`** requires `ADMIN_PASSCODE`: ≥ 16 characters, generated (README:
  `openssl rand -base64 24`). When it is unset or shorter than 16 characters the app serves 404
  for `/admin` and logs a warning at boot. Same persisted lockout as PINs, stored in
  `settings.admin_failed_attempts` / `admin_locked_until` (5 failures → 15 min, doubling), with
  the same claim-before-verify rule. On success: cookie `trax_admin`, same attributes as
  `trax_staff`, payload `{ "t": "admin", "exp", "ph" }` signed with `SESSION_SECRET`, 12 h —
  `ph` = the first 16 hex chars of `sha256(ADMIN_PASSCODE)`, checked on every request, so
  rotating the passcode revokes every admin session without touching `SESSION_SECRET` (staff
  stay logged in). Failed attempts are logged with IP.
- Auth is enforced inside every route handler and server component through shared helpers
  (`readCredential()`, `requireStaff()`, `requireWriter()`, `requireAdmin()`); `middleware.ts`,
  if used at all, is not the auth boundary.
- CSRF (defense in depth on top of SameSite=Lax + JSON bodies): cookie-authenticated mutating
  requests (status POSTs, `/login`, `/logout`, `/admin` forms) are rejected with 403 unless
  `Sec-Fetch-Site` is `same-origin` or `none`, or — when the header is absent — `Origin`
  matches the app's host. "The app's host" is `host`; `x-forwarded-host` stands in for it only
  when `TRUST_PROXY` is set (§9), so a client cannot pick the host it is compared against.
  Bearer requests skip this check. JSON endpoints require `Content-Type: application/json`
  (415 otherwise).

### 5.1 Headers and encoding

`next.config.ts` `headers()` on every route: `Strict-Transport-Security: max-age=31536000;
includeSubDomains` (Vercel adds its own; a Docker deploy behind a self-managed TLS proxy needs
this one), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`,
`Content-Security-Policy: frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'`,
`Permissions-Policy: camera=(), microphone=(), geolocation=()`. No `dangerouslySetInnerHTML`
anywhere; every string from Shopify, settings or request bodies is rendered as React text.
`/llms.txt` and `/api/*` set an explicit `Content-Type`.

## 6. Pages

- `/` — Order search box (`inputmode="numeric"`, autofocus; accepts `251548`, `#251548`,
  `Order 251548`) → `/orders/251548`. "Recent" chips for the last five orders opened on this
  device (`localStorage`, best effort). Below, two sections over the same cached, sorted list
  (§7, §8):
  - **Never set (N)** — orders in the production universe (tagged or matching
    `settings.watch_query`) that have no `item_status` yet, oldest `created_at` first.
  - **In production** — open orders tagged `trax-production`, stalest first. Row: order #,
    item counts (`{tracked}/{item_count} items`), summary, "Last updated 3 days ago by Ahmed",
    badges: red **stale** (§7), grey **waiting** when `blocked_on` is non-empty.
  - `?page=N`, 50 per page, over the cached list (no Shopify cursors in URLs). A newly tagged
    order can take a few seconds to appear (Shopify search-index lag).
- `/orders/[number]` — the screen that mirrors the existing block:
  - Header: `Order #251548`, link to Shopify admin
    (`https://admin.shopify.com/store/<SHOPIFY_ADMIN_HANDLE>/orders/<legacyResourceId>`),
    created date, fulfillment status, context fields (ships-by, due date, custody with line
    breaks, give-to) if present, and when logged in "Updating as Ahmed — Switch"
    (→ `/login?next=`).
  - Card titled **Production Status by Product**. It opens with the order-level line: the
    `summary`, the red **stale** / grey **waiting** / green **done** badges, and **Last updated
    … by …** for the order (omitted while nothing is set — the summary already says
    `No status yet`). The card re-renders this line from every write's response, so the page
    never shows two different order states. Then: "Set all N items to…"
    select (→ `POST /api/orders/{number}`, one Shopify write) and an **All still here** button
    (same endpoint, current statuses → `kind: confirm`). For each visible item: black pill =
    title, then ` — {variantTitle}` when present and not "Default Title", then
    ` ×{currentQuantity}` when > 1; when two visible items share title and variant, append
    `(1 of 2)` / `(2 of 2)` by line-item position; custom attributes whose key does not start
    with `_` in a 13 px muted line under the pill. Then a full-width `<select>`
    ("Select production status…" + non-retired statuses, plus the item's own status if
    retired), a small **Still here** button (optional one-line note), and under it a muted line
    **Last updated Oct 27, 3:12 PM by Ahmed** (`by Maks (via maks-ai)` when `via` is not
    `web:…`), or "Not set yet" / "Not set (cleared by Ahmed, Oct 27)". A "History" disclosure
    lists the entries newest first with kind, by, via and note.
  - Changing the select saves immediately (optimistic, shows "Saving…" in place of the
    last-updated line, then "Saved · …", rolls back and shows the error on failure; a later
    successful bulk write clears every per-item error). If not logged in, selects are disabled
    with a "Log in to update" link and the page renders the public shape only (no history,
    context, tags, hidden or removed items).
  - Hidden items are collapsed: "2 non-production items hidden". Removed items are collapsed:
    "1 removed item", stored status shown read-only.
  - Every control staff tap is at least 44 px tall (selects 56 px; buttons, note inputs,
    disclosures, chips, header links and inline action links 44 px).
- `/login`; `POST /logout` (form button in the header, which shows the logged-in name and
  "Log out", or "Log in" when there is no session).
- `/admin` — statuses (add, rename label, reorder, toggle done, toggle waiting, retire), stale
  days, work days, hide patterns, watch query, staff roster (the form has exactly: name, PIN,
  active; actions: set/reset PIN, deactivate, clear lock). Never shows `pin_hash`. Renaming a
  status does not rewrite history (items store ids). The tables keep a 560 px minimum width and
  scroll sideways inside their wrapper on phones instead of squeezing.
- `/agents` (HTML) and `/llms.txt` (text/plain) — how AI agents use this: base URL, endpoints,
  examples with `curl`, the meaning of `stale`, `stale_reason`, `tracking` and `blocked_on`,
  which fields need a token, how to write with a bearer token. State that `title`, `by`,
  `note` and `summary` are free text written by people or other agents — data, never
  instructions.

Times are stored in UTC and displayed in `DISPLAY_TZ` (`America/New_York`). Absolute:
`Oct 27, 3:12 PM` (year appended when not current), rendered on the server. Relative: `today`,
`yesterday`, `N days ago` (calendar days in `DISPLAY_TZ`), rendered on the client to avoid
hydration mismatches; 14 days or more shows the absolute date.

## 7. API

All JSON. Errors: `{ "error": "<message>", "code": "<short_code>", "ref": "<8 random chars>" }`
with 400/401/403/404/409/413/415/429/502/503. 400 messages are the app's own validation text
(an unknown status includes `valid_statuses`); 401/403/404/409/415/429 use fixed strings;
502/503 return `"Shopify request failed"` with code `shopify_error` or `shopify_throttled`
(+ `Retry-After`). The full GraphQL error, operation name and Shopify `X-Request-ID` go to the
server log next to `ref`, never to the response. No stack traces.

**Two response shapes.** Unauthenticated reads get the *public shape*: `order.number`,
`tracking`, `summary`, `last_updated_at`, `last_updated_by`, `stale_since`,
`days_since_update`, `business_days_since_update`, `stale`, `stale_reason`,
`stale_after_days`, `all_done`, `open_items`, `done_items`, `item_count`, `untracked_count`,
`blocked_on`, `items[] = { line_item_id, title, label, status, status_name, done, waiting,
days_since_update, stale, updated_at, updated_by }` — `label` is the pill text (title, variant,
`×n`, `(1 of 2)`, §6), deliberately public so an agent can name the right line; it exposes the
variant and quantity and nothing else. Everything else (`order.id`,
`created_at`, `admin_url`, `tags`, `fulfillment_status`, `closed`, `cancelled_at`, `context`,
`history`, `note`, `via`, `source`, `last_note`, `untracked_items`, `hidden_items`,
`removed_items`, `tag_synced`) requires a credential (staff cookie, `API_TOKENS` bearer or
`READ_TOKEN` bearer). For an order that has no `item_status`, no `trax-production` tag and
does not match `watch_query`, an unauthenticated request returns
`200 { "order": { "number": "…" }, "tracked": false }` and nothing else. Shopify order numbers
are sequential, so the public shape deliberately carries no ledger data (no dates, tags, notes
or custody).

### 7.1 Validation

`number`: strip `#` / `Order `, then `^\d{1,12}$`, else 400 — the GraphQL search string is
built from the validated digits only. `lineItemId` and every key of `items`: `^\d{1,20}$`.
`status`: a status id or name (case-insensitive, trimmed) from settings, else 400 with
`valid_statuses`. `by` ≤ 60 chars, `note` ≤ 200 chars, control characters stripped. Request
body ≤ 16 KB, `Content-Type: application/json` required (415). `days`: finite, 0–365. `page`:
1–100. Settings: status names unique and ≤ 60 chars; `hide_items_matching` entries are literal
substrings, never regex.

### 7.2 Endpoints

- `GET /api/orders/{number}` (credentialed shape shown) →
  ```json
  {
    "order": { "number": "251548", "id": "gid://shopify/Order/18936388255832",
               "created_at": "2026-10-14T05:46:01Z", "admin_url": "…", "tags": ["…"],
               "fulfillment_status": "UNFULFILLED", "closed": false, "cancelled_at": null },
    "context": { "production_date": "…", "due_date": "2026-10-30", "custody": "…", "give_to": "…" },
    "tracking": "in_progress", "summary": "0/2 done · CAD ×1 · Setting Igor ×1 — Ahmed, Oct 27",
    "last_updated_at": "2026-10-27T15:12:03Z", "last_updated_by": "Ahmed",
    "stale_since": "2026-10-22T14:00:00Z",
    "days_since_update": 5.1, "business_days_since_update": 3,
    "stale": true, "stale_reason": "no_update", "stale_after_days": 3,
    "all_done": false, "open_items": 2, "done_items": 0, "item_count": 2, "untracked_count": 0,
    "blocked_on": [], "last_note": "",
    "items": [ { "line_item_id": "50788056399960", "title": "…",
                 "variant_title": "Yellow Gold / 8 Inches", "sku": null, "quantity": 1,
                 "current_quantity": 1, "position": 1, "attributes": {},
                 "status": "cad", "status_name": "CAD", "done": false, "waiting": false,
                 "days_since_update": 5.1, "stale": true,
                 "updated_at": "…", "updated_by": "Ahmed", "source": "web", "via": "web:Ahmed",
                 "history": [ … ] } ],
    "untracked_items": [ { "line_item_id": "…", "title": "…", "variant_title": null, "position": 2 } ],
    "removed_items":   [ { "line_item_id": "…", "title": "…", "status": "polishing", "status_name": "Polishing" } ],
    "hidden_items":    [ { "line_item_id": "…", "title": "1-Month Silver Warranty" } ],
    "tag_synced": true
  }
  ```
  - `tracking` ∈ `never_set` (no `item_status`) · `in_progress` · `all_done`.
  - Staleness is **per open item**, not from the newest change: `stale_since` = oldest
    `updated_at` among open items (`order.created_at` for a visible item with no entry);
    `days_since_update` = hours since `stale_since` / 24 (float, 1 decimal);
    `business_days_since_update` = number of dates `d` with `date(stale_since) < d ≤ today`
    (both in `America/New_York`) whose ISO weekday is in `work_days` — Friday 16:00 → Monday
    10:00 = 1; `stale = !all_done && business_days_since_update >= stale_after_days`;
    `stale_reason` ∈ `never_set` · `no_update` · `waiting` (every stale open item holds a
    `waiting` status) · `shipped` (fulfilled, closed or cancelled — reported here, excluded from
    the lists) · `null`. `all_done` is true only when every visible item is done (an untracked
    visible item makes it false). `blocked_on` = names of `waiting` statuses held by open items.
    Items carry their own `days_since_update` / `stale`. `last_note` = the `note` of the most
    recent history entry across items (`""` if none).
  - A never-set order: `last_updated_at: null`, `stale_since: created_at`,
    `tracking: "never_set"`, `stale_reason: "never_set"` — it **is** stale once old enough,
    which is exactly what Maks's AI must chase.
  - `quantity` is the ordered quantity, `current_quantity` the live one (`currentQuantity`).
- `GET /api/orders` → the **production universe**: open orders tagged `trax-production` ∪ open
  orders matching `settings.watch_query`, deduplicated by id, minus `FULFILLED` ones. Rows =
  the order object without `items[].history`, `untracked_items`, `hidden_items`,
  `removed_items` (rows come from `item_status` + `visible_ids`, not line items:
  `item_count = visible_ids.length`, `untracked_count = item_count − tracked`; a never-set row
  has neither, so `item_count` / `open_items` = `currentSubtotalLineItemsQuantity` and
  `untracked_count: null`, §4.1). Sorted stalest first (never-set by `created_at` first, then
  by `stale_since`). `?page=N` (50 per page), `?stale=1` filter, `?fresh=1` bypasses the 60 s
  cache for credentialed callers only (anonymous callers get the cache). Response
  `{ page, per_page, total, truncated, checked_at, orders: [...] }`; `truncated: true` when the
  walk cap (§8) was hit.
- `GET /api/stale?days=3` → `{ days, checked_at, count, never_set_count, truncated,
  orders: [...] }` — the complete stale set, no paging, `days` overriding `stale_after_days`
  in the same business-day unit.
- `GET /api/statuses` → `{ statuses: [{ id, name, done, waiting, retired }], stale_after_days,
  work_days }`. Nothing from `staff`.
- `POST /api/orders/{number}/items/{lineItemId}` body `{ "status": "setting_igor" |
  "Setting Igor" | null, "by"?: "…", "note"?: "…" }` → the full `GET /api/orders/{number}`
  payload (credentialed shape) incl. `tag_synced`. 400 if the status is unknown or the item is
  hidden / removed.
- `POST /api/orders/{number}` body `{ "items": { "<lineItemId>": "<status id or name>" | null },
  "by"?, "note"? }` → bulk, one Shopify write, same response.
- `GET /api/health` → `{ ok, shop, api_version, served_api_version, scopes_ok }` (no secrets).
  `served_api_version` = the `X-Shopify-API-Version` response header, so a fall-forward from
  a retired version is visible; `scopes_ok` is false unless the token has `write_orders` and
  `read_all_orders`. Anonymous calls count against the public read limiter like every other
  read, and the answer is memoised per instance (30 s; 5 s after a failure), so the endpoint
  cannot be used to drain the Shopify cost bucket.

**Rate limits**: unauthenticated reads — best-effort in-memory limiter, 60 requests/min per IP
per instance → 429 with `Retry-After`, plus a 15 s in-memory cache of the public shape keyed
by order number (credentialed reads bypass it). Writes: 60/min per credential (token label or
staff id). The real backstop is a Vercel Firewall rate-limit rule for `/api/*` and `/orders/*`
(or the equivalent on the Docker reverse proxy) — README.

`read_all_orders` is **required**: without it Shopify returns only orders created in the last
60 days, which is shorter than many production runs (the four `in-production` orders found
live are all from 2025). `scripts/setup-shopify.ts` fails and `/api/health` reports
`scopes_ok: false` unless both `write_orders` and `read_all_orders` are present
(`{ currentAppInstallation { accessScopes { handle } } }`). The app version declares
`write_orders` and `read_all_orders` (`read_orders` is implied by `write_orders`; the
installation may still report it, which the setup script accepts). No Shopify approval is
needed when the app is created in the Dev Dashboard organization that owns `05nbj6-yr` (a
merchant organization); an app under a Partner organization must request and receive approval
for `read_all_orders` before declaring it, or the version fails with an `app_access` error.

## 8. Shopify client

- **Token provider**: if `SHOPIFY_ADMIN_TOKEN` is set, send it as `X-Shopify-Access-Token`.
  Otherwise mint one with the client-credentials grant — the documented path for a Dev
  Dashboard app used only by stores in its own organization (admin-created custom apps can no
  longer be created; existing ones keep working):
  `POST https://${SHOPIFY_STORE_DOMAIN}/admin/oauth/access_token`,
  `Content-Type: application/x-www-form-urlencoded`, body
  `grant_type=client_credentials&client_id=…&client_secret=…` →
  `{ access_token, scope, expires_in: 86399 }`. Cache `access_token` in memory until
  `expires_in - 300` seconds; re-mint once on an HTTP 401 before failing. One server-to-server
  POST — no redirect, no install flow, no embedded app. The mock Shopify server implements
  this endpoint.
- `shopifyGraphQL<T>(document, variables)` → POST
  `https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`. Throttling
  arrives as HTTP 200 with `errors[].extensions.code == "THROTTLED"` (not 429): wait
  `(requestedQueryCost - throttleStatus.currentlyAvailable) / throttleStatus.restoreRate`
  seconds and retry; HTTP 429 and network errors retry with backoff; HTTP 5xx retries with
  backoff **for queries only** — a mutation whose response was lost may already have been
  committed (a retry would answer `STALE_OBJECT`, re-read and record the same change twice as
  `set` + `confirm`), so a mutation 5xx goes straight to 502 `shopify_error`; 3 attempts in
  total, then 503 `shopify_throttled` / 502 `shopify_error`. Every request carries a deadline
  (`AbortSignal.timeout`, 20 s for GraphQL, 10 s for the token grant) so a stalled connection
  becomes a retried network error instead of hanging the function. Other GraphQL `errors`
  and `userErrors` become thrown errors (full text to the log, generic text to the client,
  §7). The `X-Shopify-API-Version` response header is kept for `/api/health`.
- `SHOPIFY_API_URL` (test override) is read once at boot; when set, the client refuses to
  start unless `SHOPIFY_ADMIN_TOKEN` starts with `test_` (a real token can never be sent to a
  mock host), and the effective GraphQL host is logged at startup. The app never fetches a URL
  derived from request data or metafield content. No query ever requests customer, email,
  phone, address, payment or financial fields — the only personal data the app handles is
  staff first names. Keep it that way when adding fields.
- Operations (named documents in `src/lib/shopify/queries.ts`, validated against the schema):
  `OrderByName`, `OrdersByQuery` (tagged list + watch query), `SetOrderStatus`
  (`metafieldsSet`), `AddTags`, `RemoveTags`, `ShopSettings`, `SetShopSettings`,
  `AccessScopes`, `ShopInfo`.
- `OrderByName` (verified live: `name:#251548` and `name:251548` both resolve to exactly one
  order; `#` needs no escaping — only `: \ ( )` do):
  ```graphql
  orders(first: 3, query: "name:#<n>") { nodes {
    id legacyResourceId name number createdAt closed cancelledAt displayFulfillmentStatus tags
    currentSubtotalLineItemsQuantity
    lineItems(first: 100) { nodes { id title variantTitle sku quantity currentQuantity
                                    requiresShipping isGiftCard customAttributes { key value } } }
    itemStatus:     metafield(namespace: "trax_production", key: "item_status") { value compareDigest }
    productionDate: metafield(namespace: "custom", key: "production_date") { value }
    custody:        metafield(namespace: "custom", key: "custody") { value }
    giveTo:         metafield(namespace: "custom", key: "give_to") { value }
    dueDate:        metafield(namespace: "trax_production", key: "due_date") { value }
    lastUpdatedAt:  metafield(namespace: "trax_production", key: "last_updated_at") { value }
    lastUpdatedBy:  metafield(namespace: "trax_production", key: "last_updated_by") { value }
    summary:        metafield(namespace: "trax_production", key: "summary") { value }
  } }
  ```
  The last three are what the §4.6 repair compares against. Pick the node whose `number`
  equals the requested integer (404 if none). No `product { id }` / `variant { id }` (not
  needed; they would require `read_products`).
- `OrdersByQuery`: `orders(first: 50, query: $q, sortKey: CREATED_AT, reverse: true,
  after: $cursor) { nodes { id legacyResourceId name number createdAt closed cancelledAt
  displayFulfillmentStatus tags currentSubtotalLineItemsQuantity itemStatus: … productionDate: …
  custody: … giveTo: … dueDate: … } pageInfo { hasNextPage endCursor } }` — the same metafield
  aliases as above, `value` only (the derived metafields are recomputed from `item_status`).
  Called with `q = "tag:trax-production AND status:open"` and, when non-empty,
  `q = settings.watch_query`. Shopify cannot sort by a metafield and bumps `updatedAt` for
  unrelated reasons (verified: a batch job touched #252641, #252629 and #252591 within
  seconds), so the app walks **every page** of each query (`CREATED_AT` keeps the walk stable;
  stop at 10 pages / 500 orders per query and set `truncated: true`), computes staleness from
  each order's `item_status` in memory, sorts, and caches the result 60 s per instance
  (`?fresh=1` bypasses). `/api/stale` always returns the complete set.
- `ShopSettings` = `{ shop { id name metafield(namespace: "trax_production", key: "settings")
  { value compareDigest } staff: metafield(namespace: "trax_production", key: "staff")
  { value compareDigest } } }`; `shop.id` is the `ownerId` for `SetShopSettings`.
- **Cost budget**: a single query may not exceed 1,000 points (object 1, scalar/enum 0,
  connection 2 + first × node, mutation 10; Plus restores 1,000/s — read
  `extensions.cost.throttleStatus.maximumAvailable` at runtime). `OrdersByQuery` ≈ 2 + 50 ×
  (1 + 5 metafield objects) = 302; `OrderByName` with `first: 3` and 8 metafield objects per
  order ≈ 2 + 3 × (1 + 8 + (2 + 100 × 1)) = 335 (≤ 635 if `customAttributes` is costed per
  line; verified to execute with `first: 5`). **Never add
  `lineItems` to the list query** (50 × 102 points is rejected with `MAX_COST_EXCEEDED`); list
  rows use `item_status` + `visible_ids`, with `currentSubtotalLineItemsQuantity` (a 0-cost
  scalar) as the item-count fallback.

## 9. Environment

```
SHOPIFY_STORE_DOMAIN=05nbj6-yr.myshopify.com # the myshopify domain (traxnyc.com is the storefront)
SHOPIFY_ADMIN_TOKEN=                         # optional: token of an EXISTING admin-created custom app (new ones cannot be created); scopes write_orders, read_all_orders (read_orders implied) — nothing else
SHOPIFY_CLIENT_ID=                           # Dev Dashboard app in the merchant organization that owns the store; used with the secret when SHOPIFY_ADMIN_TOKEN is empty
SHOPIFY_CLIENT_SECRET=
SHOPIFY_API_VERSION=2026-10
SHOPIFY_API_URL=                             # test-only override: full URL to …/graphql.json (the mock server); requires SHOPIFY_ADMIN_TOKEN=test_…
SHOPIFY_ADMIN_HANDLE=05nbj6-yr               # for admin.shopify.com/store/05nbj6-yr/orders/<legacyResourceId> links
SESSION_SECRET=<32+ random bytes, hex>
PIN_PEPPER=<32+ random bytes, hex>           # must differ from SESSION_SECRET
ADMIN_PASSCODE=                              # ≥ 16 chars (openssl rand -base64 24); /admin is 404 until set
API_TOKENS=claude:<random>,maks-ai:<random>  # optional; label:token pairs, each token ≥ 32 chars
READ_TOKEN=                                  # optional; ≥ 32 random chars; empty = public reads
TRUST_PROXY=                                 # which header may name the client IP: vercel = Vercel's x-real-ip / x-vercel-forwarded-for; 1 = the entry the ONE reverse proxy appended to x-forwarded-for (Docker); empty = none (shared bucket). Also gates x-forwarded-host
DISPLAY_TZ=America/New_York
```

Boot validation (`src/lib/env.ts`, imported by every route and page): `SESSION_SECRET` and
`PIN_PEPPER` must each be ≥ 64 hex chars and must differ; `ADMIN_PASSCODE` ≥ 16 chars or
`/admin` is disabled; `API_TOKENS` tokens and `READ_TOKEN` ≥ 32 chars when present; either
`SHOPIFY_ADMIN_TOKEN` or `SHOPIFY_CLIENT_ID` + `SHOPIFY_CLIENT_SECRET` must be set (or
`SHOPIFY_API_URL` with a `test_` token); `TRUST_PROXY` must be empty, `1` or `vercel`. Any
violation throws with a clear message. The code contains no default value for any secret;
tests supply explicit values via `tests/e2e/.env.test`. In Vercel, mark the secrets as
Sensitive, set `TRUST_PROXY=vercel`, and scope the Shopify credentials to the Production
environment only — preview deployments then have no Shopify credentials, refuse to boot and
answer 500 on every URL, which is expected (the README says to ignore or disable them; the
mock cannot serve previews, it binds 127.0.0.1). Rotation (README): Shopify credentials
(re-issue in the Dev Dashboard or the custom app, redeploy), `SESSION_SECRET` (logs everyone
out), `PIN_PEPPER` (invalidates every PIN — re-set them in `/admin`), `ADMIN_PASSCODE` (ends
every admin session, §5).

`.env.example` lists all of them with comments. Nothing secret is committed.

## 10. Repo layout

```
SPEC.md, README.md, CLAUDE.md (how Claude reads/writes statuses directly via Shopify)
docs/AGENTS.md (same content as /agents, for humans setting up an agent)
src/app/…  (pages + route handlers)   src/lib/… (env, shopify client, status logic, auth, settings)
src/components/…  tests/unit/…  tests/e2e/…  tests/mock-shopify/… scripts/setup-shopify.ts
Dockerfile, .dockerignore, .env.example, .gitignore, package.json, next.config.ts, tsconfig.json
```

- `scripts/setup-shopify.ts` (`npm run setup:shopify`) — idempotent:
  1. Scopes: `{ currentAppInstallation { accessScopes { handle } } }`; fails unless
     `write_orders` and `read_all_orders` are present; warns about any scope outside
     `read_orders, write_orders, read_all_orders`.
  2. Existing definitions: `metafieldDefinitions(ownerType: ORDER, namespace: "trax_production",
     first: 20) { nodes { key type { name } access { storefront } } }` (and `ownerType: SHOP`);
     skips keys that exist with the right type, aborts on a type mismatch, and fails loudly if
     storefront access is anything but `NONE` on one of ours.
  3. Creates the missing ones with `mutation ($d: MetafieldDefinitionInput!) {
     metafieldDefinitionCreate(definition: $d) { createdDefinition { id key type { name }
     access { admin storefront } } userErrors { field message code } } }` and inputs
     `{ name, namespace: "trax_production", key, type, ownerType: ORDER | SHOP, description,
     pin: false, access: { storefront: NONE } }` — never `access.admin` or
     `access.customerAccount` (rejected with `ADMIN_ACCESS_INPUT_NOT_ALLOWED` for a non-`$app`
     namespace; admin access is implicitly `PUBLIC_READ_WRITE`). Types: `item_status` json;
     `last_updated_at` date_time; `last_updated_by` and `summary` single_line_text_field with
     `validations: [{ name: "max", value: "200" }]`; SHOP `settings` and `staff` json.
     `userErrors` code `TAKEN` counts as success.
  4. Writes the default `settings` and `staff` metafields if missing. Never touches `job`,
     `due_date`, `design_image`.
- `CLAUDE.md` — prefer `POST /api/orders/...` with the `claude` bearer token. Direct Shopify
  writes are limited to `trax_production.item_status` (+ the derived `last_updated_at`,
  `last_updated_by`, `summary`) and the `trax-production` tag, following §4 exactly. Recipe:
  (1) `OrderByName` → line items with `currentQuantity` / `requiresShipping`,
  `itemStatus { value compareDigest }`; `GET /api/statuses` for ids; (2) `metafieldsSet` for
  `item_status` with `compareDigest` (explicit `null` when absent), `source: "claude"`,
  `via: "claude"`, history appended with `kind`, `visible_ids` refreshed; (3) `tagsAdd
  trax-production` (the app repairs derived fields and the tag on the next read anyway).
  Address items only by line item id; when two visible lines share a title and the request
  does not name the variant / size / position, ask — never pick; never write to hidden or
  `currentQuantity: 0` lines. Never write `trax_production.staff`; status-list edits touch only
  `settings.statuses` (with `compareDigest`).
- `Dockerfile`: `output: 'standalone'`; `.dockerignore` excludes `.env*`; secrets are injected
  at runtime; the container runs as the non-root `node` user.

## 11. Quality bar (all must pass before the build is "done")

- `npm run lint`, `npm run typecheck`, `npm run build`, `npm test` (Vitest), `npm run e2e`
  (Playwright against the mock Shopify server) — all green, run from a clean install.
- Unit tests cover: status merge (set / confirm / clear) + history cap + size trimming;
  done/tag transitions (untracked visible item ⇒ not done; removed items excluded); stale math
  (never set; one fresh done item + one old open item ⇒ stale; all-done ⇒ never stale; business
  days: Friday 16:00 → Monday 10:00 = 1; `waiting` reason); timestamp format (seconds, no
  milliseconds); PIN hash/verify + lockout state machine (5 failures → locked, success resets,
  expiry, doubling); cookie sign/verify + expiry, wrong `t` rejected, `session_version` bump
  rejected; token parsing + constant-time compare; order-number parsing (rejects injection
  strings such as `251548 OR email:x`); `item_status` schema validation; hide rules (patterns +
  `requiresShipping`); pill label (variant, ×n, 1 of 2); summary string; public-shape filter
  (no `pin_hash`, `history`, `context` or `tags` without a credential).
- e2e covers: home search → order page; login with PIN; change a status → "Last updated … by
  …" appears and the mock store received `metafieldsSet` (with `compareDigest`) + `tagsAdd`;
  "Still here" → a `kind: confirm` entry; set every item done → `tagsRemove`; mock answers
  `STALE_OBJECT` once → the write still succeeds; `/api/orders/{n}` public vs credentialed
  shapes; a watch-query order without metafields appears in `/api/stale` with
  `stale_reason: "never_set"`; a removed line (`currentQuantity: 0`) renders read-only; write
  without auth → 401; cookie POST containing `by` → 400; `/admin` with empty passcode env →
  404, wrong passcode → 401; `/admin` HTML and every JSON response contain no `pin_hash`;
  mobile viewport (390 px) renders without horizontal scroll and every tap target is ≥ 44 px;
  a tagged order with no / unreadable `item_status` is read publicly and with a credential and
  the mock receives no tag mutation; an id in `item_status` that is not on the order → 400
  `item_removed`; the order-level header follows a write without a reload; a failed single
  save (mock 5xx, sent once) shows its error until a later bulk write succeeds; visiting `/`
  while logged in keeps the session, `GET /logout` → 405, cross-site `POST /logout` → 403, the
  header's Log out button ends it; 8 parallel wrong PINs → five 401 + three 429 `locked`,
  `failed_attempts` 5, the right PIN refused while locked (same for `/admin` passcodes);
  `/api/health` is memoised.
- Mock Shopify server: dispatches on operation name, keeps orders / metafields / tags in
  memory, evaluates the `tag:` and `status:` terms of `$q` (other terms match everything),
  compares `compareDigest` and returns `STALE_OBJECT`, can return `THROTTLED` on demand,
  implements the client-credentials token endpoint, and sends `X-Shopify-API-Version`.
- Every GraphQL document validated against the Admin schema (use the Shopify MCP
  `validate_graphql_codeblocks` tool when available).
- README: Vercel deploy (Production Branch = `production-status`, previews do not boot) +
  custom domain + Firewall rate-limit rule; Shopify Dev Dashboard steps (create the app in the
  merchant organization that owns `05nbj6-yr` — a Partner-organization app must get
  `read_all_orders` approved first → add a version with scopes `write_orders`,
  `read_all_orders` → release → install on `05nbj6-yr` → copy Client ID / Client secret; the
  24 h token lifetime; the legacy `shpat_` path only for an existing admin-created app); env
  table + rotation; Docker reverse proxy (`TRUST_PROXY`); how staff
  log in; how agents read (which fields need a token); how Claude writes.

## 12. Look

Mirror `docs/reference/production-status-block.png` and the dropdown described in
`docs/reference/dropdown-options.md` (the second screenshot — the open native select — exists
only as that text description): white card, 16 px radius, light border/shadow; title
"Production Status by Product" 17 px medium; product pill: `#1f1f1f` background, white 15 px
text, fully rounded, 12 × 24 px padding; select: full width, 56 px tall, 1 px `#c9cccf` border,
12 px radius, 16 px text, up/down chevron at the right. Under each select a 13 px muted "Last
updated …" line. Phone first (staff use phones on the floor), 16 px gutters, no horizontal
scroll. Light theme only.

## 13. Decisions log

Fixed decisions were not reopened: store of record = Shopify order metafields in
`trax_production`; Next.js 15 + TypeScript; staff login = name + PIN; public JSON reads by
default; Vercel + Docker; no database; no Shopify OAuth install flow. Where reviewers
disagreed, the simpler option won. `[api]` = Shopify-API review, `[sec]` = security/privacy
review, `[ux]` = workflow/UX/agents review.

Accepted

- [api] Client-credentials token provider when no static token — accepted: shopify.dev confirms new admin-created custom apps cannot be created; the grant is one server-to-server POST, not an install flow, so "no OAuth" stands; the legacy `shpat_` path stays as an optional env (§8, §9, §11).
- [api] `status:open` on list queries, tag owned by this app — accepted (filter semantics verified). The spec already used `trax-production`; `in-production` stays untouched, so the "clean up `in-production`" alternative was not needed.
- [api] Never-updated tagged orders must be stale — accepted, generalised into `tracking: never_set` / `stale_reason: never_set` (§7).
- [api] `read_all_orders` required, scope check in setup and `/api/health` — accepted: the 60-day window would silently hide the long-running orders Maks chases most.
- [api] Exact `metafieldDefinitionCreate` input without `access.admin`, `TAKEN` = success, pre-listing definitions — accepted (§10).
- [api] 128 KB json cap → history cap + size trim + 413 — accepted with 30 entries per item and a 100,000-byte guard (reviewers said 25 / 30 / 100; 30 keeps about two weeks of churn on a busy item and stays far under the cap).
- [api] `compareDigest` explicit `null` on first write, retry only on `STALE_OBJECT`, keep the returned digest — accepted (§4.5).
- [api] Walk every page before sorting stalest-first, in-app `?page=` — accepted (§8); `sortKey` changed to `CREATED_AT` so the walk is stable while orders are being updated.
- [api] Cost budget, never `lineItems` in the list query, `THROTTLED` handling, tracked-item count — accepted; `visible_ids` added to `item_status` so list rows can count untracked items without line items.
- [api] `currentQuantity` for removed line items, `nodes { }` shorthand — accepted (§4.1, §8).
- [api] API version default `2026-10`, `served_api_version` in health — accepted.
- [api] `date_time` written at second precision — accepted.
- [api] Lookup query shape, `legacyResourceId` for admin links, `ShopSettings` with `shop { id }`, multi-line custody — accepted; `first: 3` instead of 5 keeps the query well under the 1,000-point cap even if `customAttributes` is costed per line.
- [api] Validate the settings JSON on read, storefront access `NONE` — accepted.
- [api] `metafieldsSet` before tags, `tag_synced`, reconcile on read — accepted (§4.2, §4.6).
- [sec] Persisted per-name PIN lockout, platform IP header, `timingSafeEqual`, no secret logging — accepted; PIN length is 4–8 digits rather than 6–8 because the persisted lockout (5 tries per 15 min, doubling) is the protection and a phone-passcode-length PIN is what staff on the floor will actually type.
- [sec] `ADMIN_PASSCODE` ≥ 16 chars, 404 when unset, constant-time compare, lockout, cookie attributes — accepted.
- [sec] Boot validation of secrets, no fallback defaults, Vercel Sensitive + Production scoping, `.dockerignore`, rotation notes — accepted.
- [sec] `by` / `source` taken from the credential, `via` recorded — accepted (also raised by [ux]).
- [sec] Public vs credentialed response shapes, `tracked: false` for untouched orders — accepted: reads stay public by default, the public shape just carries no ledger data; `summary` was added to the public shape since it holds nothing beyond `items[]`.
- [sec] No `?token=` in URLs, precedence between `READ_TOKEN` and `API_TOKENS` — accepted.
- [sec] Session revocation via `session_version`, typed cookie payloads, Secure always in production — accepted.
- [sec] Input validation (§7.1), null-prototype items, `item_status` schema validation on read, size caps — accepted; the size figures were replaced by the verified 128 KB json cap.
- [sec] Drop `read_products`, decide `read_all_orders`, never query customer fields, scope warning in setup — accepted (`read_all_orders` decided as required, per [api]).
- [sec] Storefront access `NONE`, `pin_hash` never rendered or returned — accepted.
- [sec] Next.js ≥ 15.2.3, auth enforced in handlers not middleware — accepted.
- [sec] Read rate limit + 15 s public cache + 503 `shopify_throttled` + firewall rule — accepted.
- [sec] CSRF `Sec-Fetch-Site` / `Origin` check, JSON content type — accepted.
- [sec] Security headers, no `dangerouslySetInnerHTML`, agent docs mark free text as data, `next` validation — accepted.
- [sec] Error shape with `code` + `ref`, GraphQL text only in logs — accepted.
- [sec] `SHOPIFY_API_URL` guard (`test_` token), no fetches derived from user data — accepted.
- [sec] Roster limited to first names, no contact details — accepted.
- [sec] `CLAUDE.md` fences direct writes away from `staff` — accepted, merged with the [ux] recipe.
- [sec] §12 referenced two screenshots but only one PNG exists — accepted; §12 now points at the PNG plus the text description.
- [ux] Never-set universe via `settings.watch_query`, `tracking`, "Never set" section, complete `/api/stale` set — accepted: without it the lists are empty on day one (0 orders tagged today) and the AI would conclude nothing needs chasing; it reuses the same list query with a second search string.
- [ux] Staleness per open item (`stale_since`), open/done counts — accepted: one fresh item must not hide a stuck one.
- [ux] `all_done` requires every visible item done — accepted.
- [ux] Removed items (`currentQuantity: 0`) read-only, excluded from done/stale, `removed_items` — accepted.
- [ux] `status:open` + fulfillment fields, shipped orders out of the lists — accepted via in-memory `FULFILLED` exclusion and `stale_reason: shipped`.
- [ux] `item_status` as the single truth with self-healing derived fields, `CLAUDE.md` recipe, `variant_title` / `position` / `attributes` on items — accepted (§4.6, §10).
- [ux] Walk all pages, 60 s cache, `?page=N`, complete `/api/stale` — accepted (same as [api]).
- [ux] `status: null` keeps the entry and history (`kind: clear`) — accepted: deleting history contradicts "every change records who and when".
- [ux] "Still here" confirmation (`kind: confirm`), "All still here" — accepted: without it the only way to stop the AI nagging about a legitimately slow piece is to lie about the status.
- [ux] Phone ergonomics: numeric input, autofocus, Recent chips, "Set all N items to…", `/login?next=`, session-expired message — accepted.
- [ux] Pill shows variant, quantity, `(1 of 2)` and custom attributes — accepted: #251548 has two bracelets that differ only by variant.
- [ux] Stable status ids with rename / retire semantics, POST accepts id or name — accepted: five statuses are named after bench workers who will change.
- [ux] `waiting` statuses — accepted in reduced form: a `waiting` flag, `blocked_on`, `stale_reason: waiting` and a grey badge; the staleness math itself is unchanged.
- [ux] Business-day staleness with `work_days` — accepted: with calendar days every Friday update is stale by Monday afternoon and the office would stop trusting the AI's emails in week one.
- [ux] `trax_production.due_date` in `context` — accepted (structured, already defined in the namespace).
- [ux] Split `settings` and `staff` into two shop metafields, both CAS-protected — accepted: a status-list edit must never be able to wipe PIN hashes.
- [ux] History cap / note cap / 100 KB guard — accepted (merged with [api]: 30 entries, 200-char notes).
- [ux] `via` on entries and "Updating as Ahmed — Switch" — accepted.
- [ux] Hide by `requiresShipping == false` / `isGiftCard` as well as title patterns — accepted (verified on #251548; one boolean in the query).
- [ux] Summary string format — accepted.
- [ux] Time display rules (server absolute, client relative) — accepted.
- [ux] PIN input attributes, stable staff `id` in the hash, POST returns the full order payload, search-index lag note — accepted.

Rejected

- [api] Admin-filterable `last_updated_at` + metafield range filter as a list optimisation — rejected: comparator unverified, orders allow only 5 filterable definitions, and walking ≤ 20 pages is enough at this volume.
- [api] Shopify-side JSON-schema `validations` on the `settings` definition — rejected: a schema inside the definition must be kept in sync with every settings change; app-side validation on read already covers it.
- [sec] 6–8 digit PIN minimum — rejected in favour of 4–8 digits with the persisted lockout (see above).
- [sec] One-shot `?token=` → `trax_read` cookie exchange for HTML pages — rejected: a third cookie type and a redirect for a convenience nobody needs; when `READ_TOKEN` is set, pages simply require a staff login (everyone in the office has a PIN).
- [ux] `POST /api/sweep` + `vercel.json` daily cron — rejected: no scheduled jobs in v1; `status:open` and the in-memory `FULFILLED` exclusion drop shipped orders from the lists, and a leftover tag on a closed order is inert.
- [ux] `force: true` to write to a removed line item — rejected: there is no reason to set a status on a line that is no longer on the order; 400 only.
- [ux] `?tag=` / `?rep=` list filters, `sales_rep` / `groups` derived from tags — rejected: credentialed rows carry `tags`, agents can filter client-side; keeps the list code to one query shape.
- [ux] Parsing `custom.production_date` into `kind` / `ships_by` / `answered_on` — rejected: free text in at least six shapes with no year; brittle. Shown raw; `due_date` is the structured field.
- [ux] Per-status `stale_after_days` override — rejected: one threshold plus the `waiting` flag is enough for v1.
- [ux] Pasted admin-URL search — rejected: needs an extra lookup by gid for a marginal gain; the three number forms are enough.
- [ux] PWA manifest / home-screen icon — rejected: v1 scope; add later if staff ask.
- [ux] Re-applying the chosen status automatically after a session-expired login — rejected: extra client state for a rare case; the page shows the message and a return link.
- [ux] `session_days` setting for shared phones — rejected: fixed 30-day cookie; the "Switch" link covers a shared device.
