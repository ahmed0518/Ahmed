# Trax Production Status

**What it is.** A small website where everyone in the office sets the production status of each
product on a Shopify order (CAD, Casting, Setting Igor, Sent to Store …) from their phone. Every
change records **who** made it and **when**. The data is saved on the Shopify order itself
(metafields), so nothing lives only in this app.

**Why.** The old "Production Status by Product" block in the private Shopify app cannot be read by
any AI. Maks's assistant (or Claude, or any agent) can now check
`GET /api/orders/251548` or `GET /api/stale` first and only email production about orders that
nobody has touched for a few work days — including orders nobody has ever set a status on.

**Where things are.**

| What | Where |
|---|---|
| The spec (single source of truth) | `SPEC.md` |
| Staff site | `https://production.traxnyc.com` (search → order → change statuses) |
| Admin (statuses, staff, PINs) | `https://production.traxnyc.com/admin` |
| For AI agents | `https://production.traxnyc.com/agents`, `/llms.txt`, `docs/AGENTS.md` |
| For Claude Code sessions | `CLAUDE.md` |

---

## 1. Create the Shopify app and get credentials

The app talks to Shopify with the Admin API. You need **one** of these two:

### Option A (recommended): a Dev Dashboard app, client credentials

1. Go to <https://dev.shopify.com> and open the organization that **owns the store**: the
   TraxNYC organization whose **Stores** list contains `05nbj6-yr` (a *merchant* organization).
   **Apps** → **Create app**, name it `Trax Production Status`.
   If the only organization you can see is a *Partner* organization (one set up by an agency,
   with no `05nbj6-yr` under Stores), `read_all_orders` needs Shopify's approval first: open
   the app → **API access requests** → **Read all orders** → **Request access**, wait for the
   approval, and only then do step 2 — declaring the scope before approval makes the version
   fail with an `app_access` validation error.
2. Open the app → **Versions** → create a version. Under **Access scopes** add
   `write_orders` and `read_all_orders`, nothing else (`read_orders` is implied by
   `write_orders`; listing it too is harmless).
   `read_all_orders` matters: without it Shopify only shows orders from the last 60 days, and
   production runs are often longer.
3. **Release** the version, then **Install** the app on the store `05nbj6-yr` (traxnyc.com).
4. From the app's **Settings / Credentials** copy the **Client ID** and **Client secret**.
   These go into `SHOPIFY_CLIENT_ID` and `SHOPIFY_CLIENT_SECRET`. The app mints its own 24-hour
   access token from them (one server-to-server call, no install screens). An app created in
   the merchant organization that owns the store needs no Shopify approval.

### Option B (legacy): an existing admin-created custom app

If you already have a custom app created from the Shopify admin (**Settings → Apps and sales
channels → Develop apps**) with the scopes above, use its **Admin API access token** (`shpat_…`)
as `SHOPIFY_ADMIN_TOKEN`. New custom apps of that kind can no longer be created; existing ones
keep working. When `SHOPIFY_ADMIN_TOKEN` is set, the client ID/secret are not used.

## 2. Deploy on Vercel

1. Push this repository to GitHub, then in Vercel **Add New → Project → Import** it. Framework
   preset: Next.js. No build settings to change.
   **The app lives on the `production-status` branch; `main` currently contains only a
   README.** Vercel builds the repository's default branch as Production, so either merge
   `production-status` into `main` before importing, or right after importing set
   **Settings → Git → Production Branch** to `production-status`. Otherwise the first
   production build has no `package.json` and fails.
2. **Environment variables** (Settings → Environment Variables). Generate the secrets on your
   Mac in Terminal:

   ```bash
   openssl rand -hex 32        # SESSION_SECRET
   openssl rand -hex 32        # PIN_PEPPER (must be different from SESSION_SECRET)
   openssl rand -base64 24     # ADMIN_PASSCODE
   openssl rand -hex 24        # one token per agent label for API_TOKENS
   ```

   | Variable | Value | Notes |
   |---|---|---|
   | `SHOPIFY_STORE_DOMAIN` | `05nbj6-yr.myshopify.com` | the myshopify domain, not traxnyc.com |
   | `SHOPIFY_CLIENT_ID` / `SHOPIFY_CLIENT_SECRET` | from step 1A | mark **Sensitive**, **Production only** |
   | `SHOPIFY_ADMIN_TOKEN` | from step 1B (optional) | Sensitive, Production only |
   | `SHOPIFY_API_VERSION` | `2026-10` | |
   | `SHOPIFY_ADMIN_HANDLE` | `05nbj6-yr` | for "Open in Shopify" links |
   | `SESSION_SECRET` | 64 hex chars | Sensitive. Changing it logs everyone out |
   | `PIN_PEPPER` | 64 hex chars, different | Sensitive. Changing it invalidates every PIN |
   | `ADMIN_PASSCODE` | 16+ chars | Sensitive. `/admin` is a 404 until this is set |
   | `API_TOKENS` | `claude:<token>,maks-ai:<token>` | Sensitive. One label per agent that may write |
   | `READ_TOKEN` | leave empty | set only if reads must stop being public (then agents need it, and staff must log in to see any order page; `/agents` and `/llms.txt` stay public — they hold no data) |
   | `TRUST_PROXY` | `vercel` | tells the app that Vercel's `x-real-ip` header is the real client IP (per-IP rate limits). Leave it empty and every anonymous caller shares one 60-requests-per-minute bucket |
   | `DISPLAY_TZ` | `America/New_York` | |

   Scope the Shopify credentials to the **Production** environment only. **Preview deployments
   (every branch other than the production one) will not start:** without Shopify credentials
   the app refuses to boot and every preview URL answers 500. That is expected — ignore them,
   or turn previews off under **Settings → Git → Ignored Build Step** by choosing *Custom* and
   entering this command (it skips every build that is not a production build):

   ```bash
   if [ "$VERCEL_ENV" = "production" ]; then exit 1; else exit 0; fi
   ```

   Use real, freshly generated values: the app refuses to start in production with the
   published test values from `tests/e2e/.env.test` and names the variable in the error.
3. **Deploy.** Check `https://<your-vercel-url>/api/health` → `"ok": true`, `"scopes_ok": true`,
   `"served_api_version": "2026-10"`, and `"throttle"` — the Shopify cost bucket the store
   gets (`maximum_available`, `restore_rate`); the home page walks up to 20 list pages of
   about 300 points each, which a Plus store restores in a few seconds. A much smaller bucket
   only makes the list slower, it is not an error.
4. **Custom domain**: Settings → Domains → add `production.traxnyc.com`, then add the CNAME
   Vercel shows at your DNS provider (where traxnyc.com's DNS lives). HTTPS is automatic.
5. **Firewall rate limit** (the real protection against hammering): Vercel project → **Firewall →
   Rules → Add rule**: path starts with `/api/` **or** `/orders/` → action **Rate limit**,
   e.g. 120 requests per minute per IP. The app also has small in-memory limits, but those reset
   on every serverless instance.

Rotation: Shopify credentials — re-issue in the Dev Dashboard (or the custom app) and redeploy.
`SESSION_SECRET` — everyone has to log in again. `PIN_PEPPER` — every PIN stops working; set
them again in `/admin`. `API_TOKENS` — give the agent its new token. `ADMIN_PASSCODE` — every
open `/admin` session ends immediately (the admin cookie is bound to the passcode it was
issued for), staff logins are untouched.

Admin lock: five wrong passcodes lock `/admin` for 15 minutes (doubling each time it happens
again), and anyone who can reach the site can cause that. The lock ends on its own when the
period is over; rotating the passcode does **not** reset it. To end it early, open the Shopify
admin → **Settings → Custom data → Shop** (metafield `trax_production.settings`) and set
`"admin_failed_attempts": 0` and `"admin_locked_until": null` in its JSON value. A locked staff
name is cleared from `/admin` ("Clear lock").

## 3. First setup

Prerequisite: **Node.js 22 LTS** on the Mac you run this from — install it from
<https://nodejs.org> (it includes `npm`); `node --version` in Terminal should print `v22.x`.

0. Get the code onto the Mac. In Terminal:

   ```bash
   git clone <repository URL> trax-production-status && cd trax-production-status
   git checkout production-status      # the app lives on this branch (see §2)
   ```

1. Create the Shopify metafield definitions and the default status list (once):

   ```bash
   cp .env.example .env.local      # then fill in EVERY value from §1 and §2, not just the Shopify ones
   npm install
   npm run setup:shopify
   ```

   The script validates the whole `.env.local` the way the site does at boot (secrets,
   tokens, time zone — everything) and stops with a message naming what is missing or wrong;
   fix that line and run it again. It is safe to run again: it only creates what is missing,
   refuses to change a definition that exists with another type, and checks the scopes. It
   never touches the existing `trax_production.job`, `due_date` or `design_image` definitions.
2. Open `https://production.traxnyc.com/admin`, enter the passcode, and add every person with a
   first name (or nickname) and a 4–8 digit PIN. The status list is already there (same order as
   the old dropdown); rename, reorder, add or retire statuses whenever you like — history keeps
   working because items store ids, not names.

## 4. How staff use it

- Open the site on the phone → type the order number (`251548`, `#251548` … all work) → the
  order page shows one black pill per product and a dropdown under each, exactly like the old
  block, plus **Last updated Oct 27, 3:12 PM by Ahmed** under every dropdown.
- First time: **Log in** → pick your name → PIN. The login lasts 30 days on that phone. On a
  shared phone, "Updating as Ahmed — Switch" changes the person; **Log out** (in the header)
  ends the session.
- Changing a dropdown saves immediately. **Still here** confirms the current status without
  changing it (so the AI stops nagging about a piece that is legitimately slow). **Set all N
  items to…** and **All still here** do the whole order at once.
- The home page lists **Never set** (orders in production that nobody has touched) and **In
  production** (stalest first, red **stale** badge after 3 work days — configurable in `/admin`).
- Warranties, shipping protection and other non-shipping lines are hidden automatically.
- Five wrong PINs lock a name for 15 minutes (doubling after that) — every attempt is counted
  before the PIN is checked, so a burst of guesses cannot slip past. `/admin` can clear a lock,
  reset a PIN or deactivate a person — which also logs them out everywhere.

## 5. How agents read

Everything is documented for machines at `/agents` (HTML), `/llms.txt` (plain text) and in
`docs/AGENTS.md`. In short:

- `GET /api/orders/251548` — one order (public shape; add `Authorization: Bearer <token>` for
  history, context, tags, admin link).
- `GET /api/stale?days=3` — every open production order nobody touched for 3 work days,
  **including orders that never got a status** (`stale_reason: "never_set"`). This is what
  Maks's AI should check before emailing anyone.
- `GET /api/orders`, `GET /api/statuses`, `GET /api/health`.

Reads are public by default (no customer data is ever exposed; the public shape carries no
tags, notes, custody, ids or admin links — its only dates are status timestamps and
`stale_since`, which is the order date for an order that never had a status, so an agent can
tell how long it has been waiting — and it does carry each item's `label`, i.e. title plus
variant and quantity, so an agent can name the right line). A wrong or rotated token on a read
is answered 401, never quietly downgraded to the public shape. Writes always need a token from
`API_TOKENS`.

## 6. How Claude writes

Give Claude the `claude` token from `API_TOKENS` and the base URL; it uses
`POST /api/orders/{number}/items/{line_item_id}` with `{ "status": "Setting Igor" }`. Claude Code
sessions with a direct Shopify connection can also write the metafields themselves — the exact
shapes and rules are in `CLAUDE.md`. Either way the entry records `via: token:claude` or
`claude`, and the app repairs the derived fields and the `trax-production` tag on the next read.

## 7. Local development

Needs Node.js 22 (see the prerequisite in §3).

```bash
npm install
cp .env.example .env.local   # fill in values; a real store needs Option A or B credentials
npm run dev                  # http://localhost:3000
```

`npm run build && npm start` runs the production build the way Docker does
(`node .next/standalone/server.js`; the build step copies the static assets next to it).

To develop **without** touching the real store, run the mock Shopify server and point the app
at it:

```bash
npm run mock:shopify                                   # http://127.0.0.1:4001
SHOPIFY_API_URL=http://127.0.0.1:4001/admin/api/2026-10/graphql.json \
SHOPIFY_ADMIN_TOKEN=test_local npm run dev
```

Seed it with `curl -X POST http://127.0.0.1:4001/__seed -H 'Content-Type: application/json' -d @seed.json`
(see `tests/e2e/fixtures.ts` for the shape) and inspect it at `http://127.0.0.1:4001/__state`.

Docker: `docker build -t trax-production-status .` then run it with the same environment
variables (`-e …` or `--env-file`). Run it behind **exactly one** reverse proxy that terminates
TLS and sets `x-forwarded-for` (nginx, Caddy and Traefik all do), set `TRUST_PROXY=1` so client
IPs come from the entry that proxy appended, and add a rate-limit rule for `/api/*` and
`/orders/*` there. Never expose the container directly: with `TRUST_PROXY` empty every
anonymous caller shares one rate-limit bucket, and with `TRUST_PROXY=1` a directly connected
client could name its own IP. The app sends `Strict-Transport-Security` itself, so the proxy
needs no extra header for that.

## 8. Tests

```bash
npm run lint        # ESLint
npm run typecheck   # TypeScript
npm run build       # Next.js production build
npm test            # unit tests (Vitest): status merge, staleness, PIN/lockout, cookies, validation …
npm run e2e         # Playwright against the mock Shopify server (never the real store)
```

`npm run e2e` builds the app, starts the mock server on port 4001 and the app on port 3000 (the
standalone server, `node .next/standalone/server.js` — the same entry point the Dockerfile
uses; `next start` is unsupported with `output: 'standalone'`) plus a second copy on 3001
without an admin passcode to prove `/admin` answers 404, then runs the
browser tests in headless Chromium. On a laptop, run `npx playwright install chromium` once
first. If a pre-installed browser lives elsewhere, set `PLAYWRIGHT_BROWSERS_PATH` or
`PW_CHROMIUM_PATH=/path/to/chrome`. `PORT`, `MOCK_SHOPIFY_PORT` and `NO_ADMIN_PORT` (the
passcode-less copy, default `PORT+1`, or `PORT+2` when that is the mock's port) change the
ports; keep the three different — `tests/e2e/ports.ts` refuses to start otherwise.
`next.config.ts` pins `outputFileTracingRoot` to the checkout, so the standalone server is
always at `.next/standalone/server.js` even when a `package-lock.json` sits in a parent
directory (a review worktree under `.claude/worktrees/`, a stray `~/package-lock.json`);
without the pin Next nests it and `npm start` / `npm run e2e` cannot find it.

Dependencies: `npm run audit:prod` runs `npm audit --omit=dev` and fails on any advisory that is
not on the accepted list in `scripts/audit.mjs`. Accepted today: four `postcss <= 8.5.22`
advisories (GHSA-qx2v-qp2m-jg93, GHSA-6g55-p6wh-862q, GHSA-fxqj-rqcc-2cmp, GHSA-r28c-9q8g-f849)
pulled in by Next 15.x — build-time CSS/source-map handling of the app's own stylesheets, not
reachable from a request. The fix lands with Next ≥ 16.3; drop them from the list when the
15.x pin goes.
