import { requireReader } from '@/lib/auth/credential';
import { handle, json } from '@/lib/api/http';
import { getEnv } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { log } from '@/lib/log';
import { servedApiVersion, shopifyGraphQL } from '@/lib/shopify/client';
import { AccessScopes, ShopInfo } from '@/lib/shopify/queries';
import type { AccessScopesData, ShopInfoData } from '@/lib/shopify/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const REQUIRED_SCOPES = ['write_orders', 'read_all_orders'];

/** `{ ok, shop, api_version, served_api_version, scopes_ok }` — no secrets. */
export const GET = handle(async (req) => {
  await requireReader(req.headers);
  const env = getEnv();
  try {
    const info = await shopifyGraphQL<ShopInfoData>(ShopInfo);
    const scopes = await shopifyGraphQL<AccessScopesData>(AccessScopes);
    const handles = new Set(scopes.currentAppInstallation.accessScopes.map((s) => s.handle));
    const scopesOk = REQUIRED_SCOPES.every((s) => handles.has(s));
    return json({
      ok: scopesOk,
      shop: info.shop.name,
      api_version: env.SHOPIFY_API_VERSION,
      served_api_version: servedApiVersion(),
      scopes_ok: scopesOk,
    });
  } catch (e) {
    log.error('health check failed', { detail: e instanceof AppError ? (e.detail ?? e.message) : String(e) });
    return json(
      {
        ok: false,
        shop: null,
        api_version: env.SHOPIFY_API_VERSION,
        served_api_version: servedApiVersion(),
        scopes_ok: false,
        error: 'Shopify request failed',
        code: e instanceof AppError ? e.code : 'shopify_error',
      },
      { status: 503 },
    );
  }
});
