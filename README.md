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

1. Go to <https://dev.shopify.com> → the **TraxNYC** organization → **Apps** → **Create app**.
   Name it `Trax Production Status`.
2. Open the app → **Versions** → create a version. Under **Access scopes** add exactly:
   `read_orders`, `write_orders`, `read_all_orders`. Nothing else.
   `read_all_orders` matters: without it Shopify only shows orders from the last 60 days, and
   production runs are often longer.
3. **Release** the version, then **Install** the app on the store `05nbj6-yr` (traxnyc.com).
4. From the app's **Settings / Credentials** copy the **Client ID** and **Client secret**.
   These go into `SHOPIFY_CLIENT_ID` and `SHOPIFY_CLIENT_SECRET`. The app mints its own 24-hour
   access token from them (one server-to-server call, no install screens). No Shopify approval
   is needed for an app used only inside its own organization.

### Option B (legacy): an existing admin-created custom app

If you already have a custom app created from the Shopify admin (**Settings → Apps and sales
channels → Develop apps**) with the scopes above, use its **Admin API access token** (`shpat_…`)
as `SHOPIFY_ADMIN_TOKEN`. New custom apps of that kind can no longer be created; existing ones
keep working. When `SHOPIFY_ADMIN_TOKEN` is set, the client ID/secret are not used.

## 2. Deploy on Vercel

1. Push this repository to GitHub, then in Vercel **Add New → Project → Import** it. Framework
   preset: Next.js. No build settings to change.
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
   | `READ_TOKEN` | leave empty | set only if reads must stop being public (then agents need it, and staff must log in to see any page) |
   | `DISPLAY_TZ` | `America/New_York` | |

   Preview deployments should get **no** Shopify credentials (or `SHOPIFY_API_URL` pointing at a
   mock); scope the Shopify ones to **Production**.
3. **Deploy.** Check `https://<your-vercel-url>/api/health` → `"ok": true`, `"scopes_ok": true`,
   `"served_api_version": "2026-10"`.
4. **Custom domain**: Settings → Domains → add `production.traxnyc.com`, then add the CNAME
   Vercel shows at your DNS provider (where traxnyc.com's DNS lives). HTTPS is automatic.
5. **Firewall rate limit** (the real protection against hammering): Vercel project → **Firewall →
   Rules → Add rule**: path starts with `/api/` **or** `/orders/` → action **Rate limit**,
   e.g. 120 requests per minute per IP. The app also has small in-memory limits, but those reset
   on every serverless instance.

Rotation: Shopify credentials — re-issue in the Dev Dashboard (or the custom app) and redeploy.
`SESSION_SECRET` — everyone has to log in again. `PIN_PEPPER` — every PIN stops working; set
them again in `/admin`. `API_TOKENS` — give the agent its new token.

## 3. First setup

1. Create the Shopify metafield definitions and the default status list (once):

   ```bash
   cp .env.example .env.local      # fill in the values from above
   npm install
   npm run setup:shopify
   ```

   It is safe to run again: it only creates what is missing, refuses to change a definition
   that exists with another type, and checks the scopes. It never touches the existing
   `trax_production.job`, `due_date` or `design_image` definitions.
2. Open `https://production.traxnyc.com/admin`, enter the passcode, and add every person with a
   first name (or nickname) and a 4–8 digit PIN. The status list is already there (same order as
   the old dropdown); rename, reorder, add or retire statuses whenever you like — history keeps
   working because items store ids, not names.

## 4. How staff use it

- Open the site on the phone → type the order number (`251548`, `#251548` … all work) → the
  order page shows one black pill per product and a dropdown under each, exactly like the old
  block, plus **Last updated Oct 27, 3:12 PM by Ahmed** under every dropdown.
- First time: **Log in** → pick your name → PIN. The login lasts 30 days on that phone. On a
  shared phone, "Updating as Ahmed — Switch" changes the person.
- Changing a dropdown saves immediately. **Still here** confirms the current status without
  changing it (so the AI stops nagging about a piece that is legitimately slow). **Set all N
  items to…** and **All still here** do the whole order at once.
- The home page lists **Never set** (orders in production that nobody has touched) and **In
  production** (stalest first, red **stale** badge after 3 work days — configurable in `/admin`).
- Warranties, shipping protection and other non-shipping lines are hidden automatically.
- Five wrong PINs lock a name for 15 minutes (doubling after that). `/admin` can clear a lock,
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

Reads are public by default (no customer data is ever exposed; the public shape has no dates
other than status timestamps, no tags, notes or custody). Writes always need a token from
`API_TOKENS`.

## 6. How Claude writes

Give Claude the `claude` token from `API_TOKENS` and the base URL; it uses
`POST /api/orders/{number}/items/{line_item_id}` with `{ "status": "Setting Igor" }`. Claude Code
sessions with a direct Shopify connection can also write the metafields themselves — the exact
shapes and rules are in `CLAUDE.md`. Either way the entry records `via: token:claude` or
`claude`, and the app repairs the derived fields and the `trax-production` tag on the next read.

## 7. Local development

```bash
npm install                  # Node 22
cp .env.example .env.local   # fill in values; a real store needs Option A or B credentials
npm run dev                  # http://localhost:3000
```

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
variables (`-e …` or `--env-file`). Behind your own reverse proxy that terminates TLS, set
`TRUST_PROXY=1` so client IPs come from `x-forwarded-for`, and add a rate-limit rule for
`/api/*` and `/orders/*` there.

## 8. Tests

```bash
npm run lint        # ESLint
npm run typecheck   # TypeScript
npm run build       # Next.js production build
npm test            # unit tests (Vitest): status merge, staleness, PIN/lockout, cookies, validation …
npm run e2e         # Playwright against the mock Shopify server (never the real store)
```

`npm run e2e` builds the app, starts the mock server on port 4001 and the app on port 3000 (and a
second copy on 3001 without an admin passcode to prove `/admin` answers 404), then runs the
browser tests in headless Chromium. On a laptop, run `npx playwright install chromium` once
first. If a pre-installed browser lives elsewhere, set `PLAYWRIGHT_BROWSERS_PATH` or
`PW_CHROMIUM_PATH=/path/to/chrome`. `PORT` and `MOCK_SHOPIFY_PORT` change the ports.
