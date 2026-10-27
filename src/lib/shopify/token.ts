import { ShopifyRequestError } from '@/lib/errors';
import { log } from '@/lib/log';

/**
 * Access-token provider (SPEC §8). A static `SHOPIFY_ADMIN_TOKEN` wins; otherwise one
 * server-to-server POST mints a 24 h token with the client-credentials grant and caches it
 * until `expires_in - 300` seconds. `get(true)` re-mints (used once on an HTTP 401).
 */

export interface TokenProvider {
  get(force?: boolean): Promise<string>;
  readonly canRemint: boolean;
}

export interface TokenProviderOptions {
  staticToken: string | null;
  clientId: string | null;
  clientSecret: string | null;
  tokenUrl: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Deadline for the token request in milliseconds (default 10 000). */
  timeoutMs?: number;
}

const EARLY_REFRESH_SECONDS = 300;
const DEFAULT_TOKEN_TIMEOUT_MS = 10_000;

export function createTokenProvider(opts: TokenProviderOptions): TokenProvider {
  if (opts.staticToken) {
    const token = opts.staticToken;
    return { canRemint: false, get: async () => token };
  }
  if (!opts.clientId || !opts.clientSecret) {
    throw new Error('Token provider needs SHOPIFY_ADMIN_TOKEN or SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET');
  }
  const clientId = opts.clientId;
  const clientSecret = opts.clientSecret;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TOKEN_TIMEOUT_MS;

  let cached: { token: string; expiresAt: number } | null = null;
  let inflight: Promise<string> | null = null;

  async function mint(): Promise<string> {
    const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret });
    let res: Response;
    try {
      res = await fetchImpl(opts.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: body.toString(),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw new ShopifyRequestError(`token request failed: ${e instanceof Error ? e.message : String(e)}`, { operation: 'AccessToken' });
    }
    if (!res.ok) {
      const text = (await res.text().catch(() => '')).slice(0, 300);
      throw new ShopifyRequestError(`token request HTTP ${res.status}: ${text}`, { operation: 'AccessToken' });
    }
    const json = (await res.json().catch(() => null)) as { access_token?: unknown; expires_in?: unknown; scope?: unknown } | null;
    if (!json || typeof json.access_token !== 'string' || !json.access_token) {
      throw new ShopifyRequestError('token response had no access_token', { operation: 'AccessToken' });
    }
    const expiresIn = typeof json.expires_in === 'number' && json.expires_in > EARLY_REFRESH_SECONDS ? json.expires_in : 86_399;
    cached = { token: json.access_token, expiresAt: now() + (expiresIn - EARLY_REFRESH_SECONDS) * 1000 };
    log.info('shopify access token minted', { expires_in: expiresIn, scope: typeof json.scope === 'string' ? json.scope : undefined });
    return cached.token;
  }

  return {
    canRemint: true,
    async get(force = false) {
      if (!force && cached && cached.expiresAt > now()) return cached.token;
      if (force) cached = null;
      if (!inflight) {
        inflight = mint().finally(() => {
          inflight = null;
        });
      }
      return inflight;
    },
  };
}
