import { expect, test } from '@playwright/test';
import { CLAUDE_TOKEN, ORDERS } from './fixtures';
import { bearer, seedAll } from './helpers';

/**
 * Last file on purpose: TRUST_PROXY is empty in the e2e run, so every anonymous caller shares
 * one 60/min bucket per app process, and this spec exhausts it for up to a minute.
 */
test.describe('anonymous read limiter', () => {
  test.beforeAll(async ({ request }) => {
    await seedAll(request);
  });

  test('every unauthenticated /api read shares the 60/min bucket — /api/statuses included', async ({ request }) => {
    let limited = 0;
    for (let i = 0; i < 70; i++) {
      const res = await request.get('/api/statuses');
      if (res.status() === 429) {
        limited++;
        expect(res.headers()['retry-after']).toMatch(/^\d+$/);
        expect((await res.json()).code).toBe('rate_limited');
      } else {
        expect(res.status(), `request ${i}`).toBe(200);
      }
    }
    expect(limited).toBeGreaterThanOrEqual(10);

    // the bucket is shared by every read path
    for (const path of ['/api/statuses', `/api/orders/${ORDERS.staleInProduction}`, '/api/orders', '/api/stale', '/api/health']) {
      expect((await request.get(path)).status(), path).toBe(429);
    }
    // credentialed reads are not in it
    expect((await request.get('/api/statuses', { headers: bearer(CLAUDE_TOKEN) })).status()).toBe(200);
    expect((await request.get(`/api/orders/${ORDERS.staleInProduction}`, { headers: bearer(CLAUDE_TOKEN) })).status()).toBe(200);
  });
});
