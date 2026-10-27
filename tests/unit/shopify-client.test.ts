import { describe, expect, it } from 'vitest';
import { ShopifyRequestError, ShopifyThrottledError } from '@/lib/errors';
import { createShopifyClient, operationName } from '@/lib/shopify/client';
import { OrdersByQuery } from '@/lib/shopify/queries';
import { createTokenProvider } from '@/lib/shopify/token';

type Reply = { status?: number; body: unknown; headers?: Record<string, string> };

function fakeFetch(replies: Reply[]) {
  const calls: { url: string; headers: Record<string, string>; body: string; signal: AbortSignal | null | undefined }[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const reply = replies.shift();
    if (!reply) throw new Error('no more replies');
    calls.push({ url: String(url), headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)), body: String(init?.body ?? ''), signal: init?.signal });
    return new Response(typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body), {
      status: reply.status ?? 200,
      headers: { 'content-type': 'application/json', 'x-shopify-api-version': '2026-10', ...(reply.headers ?? {}) },
    });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const staticTokens = { canRemint: false, get: async () => 'test_token' };
const noSleep = { waits: [] as number[], sleep: async (ms: number) => void noSleep.waits.push(ms) };

const throttled = {
  errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }],
  extensions: { cost: { requestedQueryCost: 302, throttleStatus: { maximumAvailable: 2000, currentlyAvailable: 2, restoreRate: 100 } } },
};

describe('shopify client', () => {
  it('extracts operation names and sends the token header', async () => {
    expect(operationName(OrdersByQuery)).toBe('OrdersByQuery');
    expect(operationName('mutation  AddTags($id: ID!) { x }')).toBe('AddTags');
    const { fetchImpl, calls } = fakeFetch([{ body: { data: { ok: true } } }]);
    const client = createShopifyClient({ url: 'http://mock/graphql.json', tokens: staticTokens, fetchImpl, sleep: noSleep.sleep });
    expect(await client.graphql('query ShopInfo { shop { id } }')).toEqual({ ok: true });
    expect(calls[0]!.headers['X-Shopify-Access-Token']).toBe('test_token');
    expect(JSON.parse(calls[0]!.body)).toMatchObject({ operationName: 'ShopInfo' });
    expect(client.servedApiVersion()).toBe('2026-10');
  });

  it('waits out THROTTLED and retries, then gives up with 503', async () => {
    noSleep.waits.length = 0;
    const ok = fakeFetch([{ body: throttled }, { body: { data: { fine: 1 } } }]);
    const client = createShopifyClient({ url: 'http://mock/graphql.json', tokens: staticTokens, fetchImpl: ok.fetchImpl, sleep: noSleep.sleep });
    expect(await client.graphql('query A { a }')).toEqual({ fine: 1 });
    expect(noSleep.waits[0]).toBeCloseTo(3000, -2);

    const bad = fakeFetch([{ body: throttled }, { body: throttled }, { body: throttled }]);
    const client2 = createShopifyClient({ url: 'http://mock/graphql.json', tokens: staticTokens, fetchImpl: bad.fetchImpl, sleep: noSleep.sleep });
    const err = await client2.graphql('query A { a }').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ShopifyThrottledError);
    expect(err).toMatchObject({ status: 503, code: 'shopify_throttled', retryAfter: 5 });
    expect(bad.calls).toHaveLength(3);
  });

  it('retries 5xx with backoff and turns GraphQL errors into 502 with the detail in the error, not the message', async () => {
    const f = fakeFetch([{ status: 502, body: 'bad gateway' }, { status: 503, body: 'down' }, { body: { data: { x: 1 } } }]);
    const client = createShopifyClient({ url: 'http://mock/graphql.json', tokens: staticTokens, fetchImpl: f.fetchImpl, sleep: noSleep.sleep });
    expect(await client.graphql('query A { a }')).toEqual({ x: 1 });

    const g = fakeFetch([{ body: { errors: [{ message: 'Field "nope" does not exist' }] } }]);
    const client2 = createShopifyClient({ url: 'http://mock/graphql.json', tokens: staticTokens, fetchImpl: g.fetchImpl, sleep: noSleep.sleep });
    const err = await client2.graphql('query A { a }').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ShopifyRequestError);
    expect((err as ShopifyRequestError).message).toBe('Shopify request failed');
    expect((err as ShopifyRequestError).detail).toContain('does not exist');
    expect((err as ShopifyRequestError).status).toBe(502);
  });

  it('never re-sends a mutation after a 5xx (it may have been committed) but does after a 429', async () => {
    const mutation = 'mutation SetOrderStatus($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { userErrors { code } } }';
    const lost = fakeFetch([{ status: 502, body: 'bad gateway' }, { body: { data: { metafieldsSet: { userErrors: [] } } } }]);
    const client = createShopifyClient({ url: 'http://mock/graphql.json', tokens: staticTokens, fetchImpl: lost.fetchImpl, sleep: noSleep.sleep });
    const err = await client.graphql(mutation).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ShopifyRequestError);
    expect((err as ShopifyRequestError).detail).toContain('HTTP 502');
    expect(lost.calls).toHaveLength(1);

    const rejected = fakeFetch([{ status: 429, body: '', headers: { 'retry-after': '1' } }, { body: { data: { metafieldsSet: { userErrors: [] } } } }]);
    const client2 = createShopifyClient({ url: 'http://mock/graphql.json', tokens: staticTokens, fetchImpl: rejected.fetchImpl, sleep: noSleep.sleep });
    expect(await client2.graphql(mutation)).toEqual({ metafieldsSet: { userErrors: [] } });
    expect(rejected.calls).toHaveLength(2);

    // a query still gets its 5xx retry
    const query = fakeFetch([{ status: 502, body: 'bad gateway' }, { body: { data: { x: 1 } } }]);
    const client3 = createShopifyClient({ url: 'http://mock/graphql.json', tokens: staticTokens, fetchImpl: query.fetchImpl, sleep: noSleep.sleep });
    expect(await client3.graphql('query A { a }')).toEqual({ x: 1 });
    expect(query.calls).toHaveLength(2);
  });

  it('gives every request a deadline and treats a stalled connection as a retried network error', async () => {
    const { fetchImpl, calls } = fakeFetch([{ body: { data: { ok: true } } }]);
    const client = createShopifyClient({ url: 'http://mock/graphql.json', tokens: staticTokens, fetchImpl, sleep: noSleep.sleep, timeoutMs: 1234 });
    await client.graphql('query A { a }');
    expect(calls[0]!.signal).toBeInstanceOf(AbortSignal);

    let attempts = 0;
    const stalled = (async (_url: string | URL | Request, init?: RequestInit) => {
      attempts++;
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason ?? new Error('aborted')));
      });
    }) as typeof fetch;
    const client2 = createShopifyClient({ url: 'http://mock/graphql.json', tokens: staticTokens, fetchImpl: stalled, sleep: noSleep.sleep, timeoutMs: 20 });
    const err = await client2.graphql('query A { a }').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ShopifyRequestError);
    expect((err as ShopifyRequestError).detail).toContain('network error');
    expect(attempts).toBe(3);
  });

  it('re-mints once on 401 when using client credentials', async () => {
    const tokenFetch = fakeFetch([
      { body: { access_token: 'minted_1', scope: 'write_orders', expires_in: 86399 } },
      { body: { access_token: 'minted_2', scope: 'write_orders', expires_in: 86399 } },
    ]);
    let now = 1_000_000;
    const tokens = createTokenProvider({ staticToken: null, clientId: 'id', clientSecret: 'secret', tokenUrl: 'http://mock/admin/oauth/access_token', fetchImpl: tokenFetch.fetchImpl, now: () => now });
    expect(await tokens.get()).toBe('minted_1');
    expect(await tokens.get()).toBe('minted_1'); // cached
    expect(tokenFetch.calls[0]!.body).toContain('grant_type=client_credentials');
    now += (86399 - 300) * 1000 + 1;
    expect(await tokens.get()).toBe('minted_2'); // expired → re-minted

    const gql = fakeFetch([{ status: 401, body: { errors: 'invalid token' } }, { body: { data: { ok: 1 } } }]);
    const tokens2 = createTokenProvider({
      staticToken: null,
      clientId: 'id',
      clientSecret: 'secret',
      tokenUrl: 'http://mock/token',
      fetchImpl: fakeFetch([{ body: { access_token: 'a', expires_in: 86399 } }, { body: { access_token: 'b', expires_in: 86399 } }]).fetchImpl,
    });
    const client = createShopifyClient({ url: 'http://mock/graphql.json', tokens: tokens2, fetchImpl: gql.fetchImpl, sleep: noSleep.sleep });
    expect(await client.graphql('query A { a }')).toEqual({ ok: 1 });
    expect(gql.calls[0]!.headers['X-Shopify-Access-Token']).toBe('a');
    expect(gql.calls[1]!.headers['X-Shopify-Access-Token']).toBe('b');
  });
});
