import { getEnv } from '@/lib/env';
import { ShopifyRequestError, ShopifyThrottledError } from '@/lib/errors';
import { log } from '@/lib/log';
import { createTokenProvider, type TokenProvider } from './token';

/**
 * Admin GraphQL via fetch (SPEC §8). Throttling arrives as HTTP 200 with
 * `errors[].extensions.code == "THROTTLED"`: wait for the cost to restore and retry; HTTP
 * 429 and network errors retry with backoff; HTTP 5xx retries with backoff for queries only
 * (a mutation whose response was lost may already have been committed, so it is never
 * re-sent); 3 attempts in total. Every request carries a deadline (`timeoutMs`, default
 * 20 s) so a stalled connection surfaces as a network error instead of hanging the caller.
 * One re-mint on HTTP 401 when the token comes from the client-credentials grant. GraphQL
 * errors become thrown errors whose full text goes to the log only.
 */

export interface ShopifyClient {
  graphql<T>(document: string, variables?: Record<string, unknown>): Promise<T>;
  servedApiVersion(): string | null;
  readonly url: string;
}

export interface ClientOptions {
  url: string;
  tokens: TokenProvider;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
  /** Per-request deadline in milliseconds (default 20 000). */
  timeoutMs?: number;
}

export const DEFAULT_TIMEOUT_MS = 20_000;

export function isMutation(document: string): boolean {
  return /^\s*mutation\b/.test(document);
}

interface GraphQLErrorShape {
  message?: string;
  extensions?: { code?: string; [k: string]: unknown };
}

interface GraphQLResponse {
  data?: unknown;
  errors?: GraphQLErrorShape[];
  extensions?: {
    cost?: {
      requestedQueryCost?: number;
      actualQueryCost?: number | null;
      throttleStatus?: { maximumAvailable?: number; currentlyAvailable?: number; restoreRate?: number };
    };
  };
}

export function operationName(document: string): string {
  const m = /^\s*(?:query|mutation)\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(document);
  return m?.[1] ?? 'anonymous';
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createShopifyClient(opts: ClientOptions): ShopifyClient {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const maxAttempts = opts.maxAttempts ?? 3;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let servedVersion: string | null = null;

  async function graphql<T>(document: string, variables: Record<string, unknown> = {}): Promise<T> {
    const op = operationName(document);
    const mutation = isMutation(document);
    let reminted = false;
    let throttled = false;
    let lastDetail = '';
    let lastRequestId: string | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const token = await opts.tokens.get();
      let res: Response;
      try {
        res = await fetchImpl(opts.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'X-Shopify-Access-Token': token,
          },
          body: JSON.stringify({ query: document, variables, operationName: op }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (e) {
        lastDetail = `network error: ${e instanceof Error ? e.message : String(e)}`;
        log.warn('shopify network error', { operation: op, attempt, detail: lastDetail });
        if (attempt < maxAttempts) await sleep(300 * attempt);
        continue;
      }

      const version = res.headers.get('x-shopify-api-version');
      if (version) servedVersion = version;
      lastRequestId = res.headers.get('x-request-id');

      if (res.status === 401 && opts.tokens.canRemint && !reminted) {
        reminted = true;
        log.warn('shopify 401, re-minting access token', { operation: op, requestId: lastRequestId });
        await opts.tokens.get(true);
        attempt--; // the re-mint does not consume an attempt
        continue;
      }

      // A 429 was rejected before execution, so it is safe to re-send anything. A 5xx may
      // have executed the mutation already (lost response) — only queries are retried.
      if (res.status === 429 || (res.status >= 500 && !mutation)) {
        throttled = res.status === 429;
        const retryAfter = Number(res.headers.get('retry-after')) || 0;
        lastDetail = `HTTP ${res.status}`;
        log.warn('shopify http error, retrying', { operation: op, status: res.status, attempt, requestId: lastRequestId });
        if (attempt < maxAttempts) await sleep(retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** (attempt - 1));
        continue;
      }

      if (!res.ok) {
        const text = (await res.text().catch(() => '')).slice(0, 500);
        throw new ShopifyRequestError(`HTTP ${res.status}: ${text}`, { operation: op, requestId: lastRequestId });
      }

      let json: GraphQLResponse;
      try {
        json = (await res.json()) as GraphQLResponse;
      } catch {
        throw new ShopifyRequestError('response was not JSON', { operation: op, requestId: lastRequestId });
      }

      if (json.errors && json.errors.length > 0) {
        const isThrottled = json.errors.some((e) => e.extensions?.code === 'THROTTLED');
        if (isThrottled) {
          throttled = true;
          const cost = json.extensions?.cost;
          const requested = cost?.requestedQueryCost ?? 0;
          const available = cost?.throttleStatus?.currentlyAvailable ?? 0;
          const restore = cost?.throttleStatus?.restoreRate ?? 50;
          const waitSeconds = Math.max(0.2, Math.min(10, (requested - available) / Math.max(1, restore)));
          log.warn('shopify throttled', { operation: op, attempt, waitSeconds, requestId: lastRequestId });
          if (attempt < maxAttempts) await sleep(waitSeconds * 1000);
          continue;
        }
        throw new ShopifyRequestError(JSON.stringify(json.errors).slice(0, 2000), { operation: op, requestId: lastRequestId });
      }

      if (json.data === undefined || json.data === null) {
        throw new ShopifyRequestError('response had no data', { operation: op, requestId: lastRequestId });
      }
      return json.data as T;
    }

    if (throttled) throw new ShopifyThrottledError(5, op);
    throw new ShopifyRequestError(lastDetail || 'exhausted retries', { operation: op, requestId: lastRequestId });
  }

  return { graphql, servedApiVersion: () => servedVersion, url: opts.url };
}

let instance: ShopifyClient | null = null;

/** The app's client, built once from the validated environment. */
export function shopify(): ShopifyClient {
  if (!instance) {
    const env = getEnv();
    const tokens = createTokenProvider({
      staticToken: env.SHOPIFY_ADMIN_TOKEN,
      clientId: env.SHOPIFY_CLIENT_ID,
      clientSecret: env.SHOPIFY_CLIENT_SECRET,
      tokenUrl: env.tokenUrl,
    });
    instance = createShopifyClient({ url: env.graphqlUrl, tokens });
    log.info('shopify client ready', { host: new URL(env.graphqlUrl).host, api_version: env.SHOPIFY_API_VERSION, mock: env.SHOPIFY_API_URL !== null });
  }
  return instance;
}

export function shopifyGraphQL<T>(document: string, variables?: Record<string, unknown>): Promise<T> {
  return shopify().graphql<T>(document, variables);
}

export function servedApiVersion(): string | null {
  return instance?.servedApiVersion() ?? null;
}

/** First userError with one of the given codes, or null. */
export function findUserErrorCode(errors: readonly { code?: string | null }[], codes: readonly string[]): string | null {
  for (const e of errors) {
    if (e.code && codes.includes(e.code)) return e.code;
  }
  return null;
}
