import { requireReader } from '@/lib/auth/credential';
import { clientIp } from '@/lib/auth/csrf';
import { publicReadLimiter } from '@/lib/auth/ratelimit';
import { handle, json } from '@/lib/api/http';
import { getEnv } from '@/lib/env';
import { AppError, tooManyRequests } from '@/lib/errors';
import { log } from '@/lib/log';
import { servedApiVersion, shopifyGraphQL } from '@/lib/shopify/client';
import { AccessScopes, ShopInfo } from '@/lib/shopify/queries';
import type { AccessScopesData, ShopInfoData } from '@/lib/shopify/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const REQUIRED_SCOPES = ['write_orders', 'read_all_orders'];
const OK_CACHE_MS = 30_000;
const FAIL_CACHE_MS = 5_000;

let cached: { expires: number; status: number; body: Record<string, unknown> } | null = null;

/**
 * `{ ok, shop, api_version, served_api_version, scopes_ok }` — no secrets. Anonymous calls
 * share the public read limiter, and the answer is memoised (30 s, 5 s after a failure) so
 * nobody can drain the Shopify cost bucket through this endpoint.
 */
export const GET = handle(async (req) => {
  const cred = await requireReader(req.headers);
  const env = getEnv();
  if (!cred) {
    const limit = publicReadLimiter.check(clientIp(req.headers, env.TRUST_PROXY));
    if (!limit.ok) throw tooManyRequests(limit.retryAfter);
  }
  if (cached && cached.expires > Date.now()) return json(cached.body, { status: cached.status });
  try {
    const info = await shopifyGraphQL<ShopInfoData>(ShopInfo);
    const scopes = await shopifyGraphQL<AccessScopesData>(AccessScopes);
    const handles = new Set(scopes.currentAppInstallation.accessScopes.map((s) => s.handle));
    const scopesOk = REQUIRED_SCOPES.every((s) => handles.has(s));
    const body = {
      ok: scopesOk,
      shop: info.shop.name,
      api_version: env.SHOPIFY_API_VERSION,
      served_api_version: servedApiVersion(),
      scopes_ok: scopesOk,
    };
    cached = { expires: Date.now() + OK_CACHE_MS, status: 200, body };
    return json(body);
  } catch (e) {
    log.error('health check failed', { detail: e instanceof AppError ? (e.detail ?? e.message) : String(e) });
    const body = {
      ok: false,
      shop: null,
      api_version: env.SHOPIFY_API_VERSION,
      served_api_version: servedApiVersion(),
      scopes_ok: false,
      error: 'Shopify request failed',
      code: e instanceof AppError ? e.code : 'shopify_error',
    };
    cached = { expires: Date.now() + FAIL_CACHE_MS, status: 503, body };
    return json(body, { status: 503 });
  }
});
