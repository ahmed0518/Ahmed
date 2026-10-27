import { expect, test } from '@playwright/test';
import { CLAUDE_TOKEN, MAKS_TOKEN, ORDERS } from './fixtures';
import { bearer, loginAs, mockOrder, mockState, originHeader, refreshList, seedAll, seedExtra } from './helpers';

test.describe('API', () => {
  test.beforeAll(async ({ request }) => {
    await seedAll(request);
    await refreshList(request, CLAUDE_TOKEN);
  });

  test('public vs credentialed shapes', async ({ request }) => {
    const pub = await request.get(`/api/orders/${ORDERS.staleInProduction}`);
    expect(pub.status()).toBe(200);
    expect(pub.headers()['content-type']).toContain('application/json');
    const p = (await pub.json()) as Record<string, unknown>;
    expect(p.order).toEqual({ number: String(ORDERS.staleInProduction) });
    expect(p.tracking).toBe('in_progress');
    expect(p.stale).toBe(true);
    expect(p.stale_reason).toBe('no_update');
    expect(p.business_days_since_update).toBeGreaterThanOrEqual(4);
    expect(p.item_count).toBe(2);
    expect(p.untracked_count).toBe(0);
    for (const key of ['context', 'tags', 'history', 'last_note', 'untracked_items', 'hidden_items', 'removed_items', 'tag_synced', 'admin_url']) {
      expect(JSON.stringify(p), key).not.toContain(`"${key}"`);
    }
    const items = p.items as Record<string, unknown>[];
    expect(items.map((i) => i.line_item_id)).toEqual(['60000000000001', '60000000000002']);
    expect(items[0]).not.toHaveProperty('via');
    expect(items[0]!.label).toBe('Custom Silver 2.5-Inches Pendant - LAB Diamonds');
    expect(items[1]!.label).toBe('14K Rope Chain 3mm — 22 Inches ×2');

    const full = await request.get(`/api/orders/${ORDERS.staleInProduction}`, { headers: bearer(CLAUDE_TOKEN) });
    expect(full.status()).toBe(200);
    const f = (await full.json()) as Record<string, unknown> & { order: Record<string, unknown>; items: Record<string, unknown>[]; context: Record<string, unknown> };
    expect(f.order.id).toMatch(/^gid:\/\/shopify\/Order\//);
    expect(f.order.admin_url).toContain('admin.shopify.com/store/mock-store/orders/');
    expect(f.order.tags).toContain('trax-production');
    expect(f.order.fulfillment_status).toBe('UNFULFILLED');
    expect(f.context).toHaveProperty('production_date');
    expect(f.items[0]!.history).toHaveLength(1);
    expect(f.items[0]!.via).toBe('web:Ahmed');
    expect(f.items[0]!.attributes).toEqual({ Engraving: 'MOM' });
    expect(f.tag_synced).toBe(true);
    expect(f.last_note).toBe('');

    // a bearer token that matches nothing is 401, never a quiet downgrade to the public shape
    const wrong = await request.get(`/api/orders/${ORDERS.staleInProduction}`, { headers: bearer('this-token-is-wrong-0123456789abcdef0123456789') });
    expect(wrong.status()).toBe(401);
    expect((await wrong.json()).code).toBe('unauthorized');
    expect((await request.get('/api/stale', { headers: bearer('wrong') })).status()).toBe(401);
  });

  test('an order outside the production universe is tracked:false publicly, never_set with a credential', async ({ request }) => {
    const pub = await request.get(`/api/orders/${ORDERS.untracked}`);
    expect(await pub.json()).toEqual({ order: { number: String(ORDERS.untracked) }, tracked: false });
    const full = (await (await request.get(`/api/orders/${ORDERS.untracked}`, { headers: bearer(CLAUDE_TOKEN) })).json()) as Record<string, unknown>;
    expect(full.tracking).toBe('never_set');
    expect(full.untracked_items).toHaveLength(1);
    expect(await (await request.get('/api/orders/999999')).json()).toMatchObject({ code: 'order_not_found' });
  });

  test('/api/stale lists never-set watch-query orders and skips shipped and fresh ones', async ({ request }) => {
    const res = await request.get('/api/stale');
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { days: number; count: number; never_set_count: number; truncated: boolean; orders: Record<string, unknown>[] };
    expect(body.days).toBe(3);
    expect(body.truncated).toBe(false);
    const numbers = body.orders.map((o) => (o.order as { number: string }).number);
    expect(numbers).toContain(String(ORDERS.watchNeverSet));
    expect(numbers).toContain(String(ORDERS.neverSet));
    expect(numbers).toContain(String(ORDERS.staleInProduction));
    expect(numbers).not.toContain(String(ORDERS.shipped));
    expect(numbers).not.toContain(String(ORDERS.freshInProduction));
    expect(numbers).not.toContain(String(ORDERS.untracked));
    const watch = body.orders.find((o) => (o.order as { number: string }).number === String(ORDERS.watchNeverSet))!;
    // never set: counts come from the Shopify quantity and untracked_count is unknown (SPEC §4.1 / §7.2)
    expect(watch).toMatchObject({ tracking: 'never_set', stale: true, stale_reason: 'never_set', last_updated_at: null, item_count: 1, open_items: 1, untracked_count: null });
    const threeLines = body.orders.find((o) => (o.order as { number: string }).number === String(ORDERS.neverSet))!;
    expect(threeLines).toMatchObject({ tracking: 'never_set', item_count: 3, open_items: 3, untracked_count: null });
    expect(numbers).toContain(String(ORDERS.taggedNeverSet));
    expect(numbers).toContain(String(ORDERS.malformedStatus));
    expect(body.never_set_count).toBeGreaterThanOrEqual(2);
    expect(body.count).toBe(body.orders.length);
    expect(numbers.indexOf(String(ORDERS.watchNeverSet))).toBeLessThan(numbers.indexOf(String(ORDERS.neverSet)));

    const wide = (await (await request.get('/api/stale?days=0')).json()) as { orders: Record<string, unknown>[] };
    expect(wide.orders.map((o) => (o.order as { number: string }).number)).toContain(String(ORDERS.freshInProduction));
    expect((await request.get('/api/stale?days=400')).status()).toBe(400);
  });

  test('/api/orders pages the universe and /api/statuses carries nothing from staff', async ({ request }) => {
    const list = (await (await request.get('/api/orders?page=1', { headers: bearer(CLAUDE_TOKEN) })).json()) as { page: number; per_page: number; total: number; orders: Record<string, unknown>[] };
    expect(list.page).toBe(1);
    expect(list.per_page).toBe(50);
    expect(list.total).toBeGreaterThanOrEqual(7);
    expect(list.orders[0]).toHaveProperty('order.tags');
    const stale = (await (await request.get('/api/orders?stale=1')).json()) as { orders: Record<string, unknown>[] };
    expect(stale.orders.every((o) => o.stale === true)).toBe(true);
    expect(stale.orders[0]).not.toHaveProperty('context');
    expect((await request.get('/api/orders?page=0')).status()).toBe(400);

    const statuses = (await (await request.get('/api/statuses')).json()) as { statuses: { id: string; name: string; done: boolean }[]; stale_after_days: number; work_days: number[] };
    expect(statuses.statuses[0]).toEqual({ id: 'cad', name: 'CAD', done: false, waiting: false, retired: false });
    expect(statuses.statuses.find((s) => s.id === 'sent_to_store')?.done).toBe(true);
    expect(statuses.stale_after_days).toBe(3);
    expect(statuses.work_days).toEqual([1, 2, 3, 4, 5]);
  });

  test('writes: 401 without auth, 400 for "by" with a cookie, bearer writes record by/via/source', async ({ page, request }) => {
    const anon = await request.post(`/api/orders/${ORDERS.freshInProduction}/items/60000000000011`, { data: { status: 'polishing' }, headers: { 'Content-Type': 'application/json' } });
    expect(anon.status()).toBe(401);
    const err = (await anon.json()) as { error: string; code: string; ref: string };
    expect(err).toMatchObject({ code: 'unauthorized' });
    expect(err.ref).toMatch(/^[a-z0-9]{8}$/);

    await loginAs(page, 'ahmed');
    const withBy = await page.request.post(`/api/orders/${ORDERS.freshInProduction}/items/60000000000011`, { data: { status: 'polishing', by: 'Someone' }, headers: originHeader() });
    expect(withBy.status()).toBe(400);
    expect((await withBy.json()).code).toBe('by_not_allowed');

    const noCsrf = await page.request.post(`/api/orders/${ORDERS.freshInProduction}/items/60000000000011`, { data: { status: 'polishing' }, headers: { 'Content-Type': 'application/json', Origin: 'https://evil.test' } });
    expect(noCsrf.status()).toBe(403);

    const notJson = await request.post(`/api/orders/${ORDERS.freshInProduction}/items/60000000000011`, { data: 'status=polishing', headers: { ...bearer(MAKS_TOKEN), 'Content-Type': 'text/plain' } });
    expect(notJson.status()).toBe(415);

    const unknown = await request.post(`/api/orders/${ORDERS.freshInProduction}/items/60000000000011`, { data: { status: 'teleporting' }, headers: bearer(MAKS_TOKEN) });
    expect(unknown.status()).toBe(400);
    const u = (await unknown.json()) as { code: string; valid_statuses: string[] };
    expect(u.code).toBe('unknown_status');
    expect(u.valid_statuses).toContain('Setting Igor');
    expect(u.valid_statuses).not.toContain('Old Bench');

    const ok = await request.post(`/api/orders/${ORDERS.freshInProduction}/items/60000000000011`, { data: { status: 'Setting Jorje', by: 'Maks', note: 'customer called' }, headers: bearer(MAKS_TOKEN) });
    expect(ok.status(), await ok.text()).toBe(200);
    const body = (await ok.json()) as { items: Record<string, unknown>[]; last_updated_by: string; last_note: string; tag_synced: boolean };
    expect(body.items[0]).toMatchObject({ status: 'setting_jorje', status_name: 'Setting Jorje', updated_by: 'Maks', via: 'token:maks-ai', source: 'api' });
    expect(body.last_updated_by).toBe('Maks');
    expect(body.last_note).toBe('customer called');
    expect(body.tag_synced).toBe(true);

    const hidden = await request.post(`/api/orders/${ORDERS.neverSet}/items/50788056465496`, { data: { status: 'cad' }, headers: bearer(MAKS_TOKEN) });
    expect((await hidden.json()).code).toBe('item_hidden');
    const removed = await request.post(`/api/orders/${ORDERS.removedLine}/items/60000000000022`, { data: { status: 'cad' }, headers: bearer(MAKS_TOKEN) });
    expect(removed.status()).toBe(400);
    expect((await removed.json()).code).toBe('item_removed');
    // an id item_status knows but the order no longer lists is removed too (400), an unknown id is 404
    const orphan = await request.post(`/api/orders/${ORDERS.orphanEntry}/items/60000000000139`, { data: { status: 'cad' }, headers: bearer(MAKS_TOKEN) });
    expect(orphan.status()).toBe(400);
    expect((await orphan.json()).code).toBe('item_removed');
    const unknownId = await request.post(`/api/orders/${ORDERS.orphanEntry}/items/60000000000199`, { data: { status: 'cad' }, headers: bearer(MAKS_TOKEN) });
    expect(unknownId.status()).toBe(404);
    expect((await unknownId.json()).code).toBe('item_not_found');
    const orphanRead = (await (await request.get(`/api/orders/${ORDERS.orphanEntry}`, { headers: bearer(CLAUDE_TOKEN) })).json()) as { removed_items: { line_item_id: string }[] };
    expect(orphanRead.removed_items.map((r) => r.line_item_id)).toEqual(['60000000000139']);
    const badNumber = await request.get('/api/orders/251548%20OR%20email:x');
    expect(badNumber.status()).toBe(400);
  });

  test('a retired status is refused as a new selection by id or name, but "still here" on the item holding it works', async ({ request }) => {
    for (const status of ['old_bench', 'Old Bench']) {
      const res = await request.post(`/api/orders/${ORDERS.freshInProduction}/items/60000000000011`, { data: { status }, headers: bearer(MAKS_TOKEN) });
      expect(res.status(), status).toBe(400);
      const body = (await res.json()) as { code: string; valid_statuses: string[] };
      expect(body.code).toBe('status_retired');
      expect(body.valid_statuses).not.toContain('Old Bench');
      expect(body.valid_statuses).toContain('Setting Igor');
    }
    const bulk = await request.post(`/api/orders/${ORDERS.freshInProduction}`, { data: { items: { '60000000000011': 'old_bench' } }, headers: bearer(MAKS_TOKEN) });
    expect(bulk.status()).toBe(400);
    expect((await bulk.json()).code).toBe('status_retired');
    const untouched = (await (await request.get(`/api/orders/${ORDERS.freshInProduction}`, { headers: bearer(CLAUDE_TOKEN) })).json()) as { items: { status: string }[] };
    expect(untouched.items[0]!.status).not.toBe('old_bench');

    const confirm = await request.post(`/api/orders/${ORDERS.retiredStatus}/items/60000000000141`, { data: { status: 'Old Bench', note: 'still at the old bench' }, headers: bearer(MAKS_TOKEN) });
    expect(confirm.status(), await confirm.text()).toBe(200);
    const c = (await confirm.json()) as { items: { status: string; status_name: string; history: { kind: string; note: string }[] }[] };
    expect(c.items[0]).toMatchObject({ status: 'old_bench', status_name: 'Old Bench' });
    expect(c.items[0]!.history.at(-1)).toMatchObject({ kind: 'confirm', note: 'still at the old bench' });

    const statuses = (await (await request.get('/api/statuses')).json()) as { statuses: Record<string, unknown>[] };
    expect(statuses.statuses.find((s) => s.id === 'old_bench')).toEqual({ id: 'old_bench', name: 'Old Bench', done: false, waiting: false, retired: true });
  });

  test('reading a tagged order with no readable entries never touches its tag', async ({ request }) => {
    for (const number of [ORDERS.taggedNeverSet, ORDERS.malformedStatus]) {
      await seedExtra(request, { clear_calls: true });
      const pub = (await (await request.get(`/api/orders/${number}`)).json()) as Record<string, unknown>;
      expect(pub.tracking, String(number)).toBe('never_set');
      expect(pub.stale_reason, String(number)).toBe('never_set');
      const full = (await (await request.get(`/api/orders/${number}`, { headers: bearer(CLAUDE_TOKEN) })).json()) as Record<string, unknown> & { order: { tags: string[] } };
      expect(full.tracking, String(number)).toBe('never_set');
      expect(full.tag_synced, String(number)).toBe(true);
      expect(full.order.tags, String(number)).toContain('trax-production');
      if (number === ORDERS.malformedStatus) expect(full.status_data_unreadable).toBe(true);

      const state = await mockState(request);
      const order = mockOrder(state, number);
      expect(order.tags, String(number)).toContain('trax-production');
      const tagCalls = state.calls.filter((c) => (c.operation === 'RemoveTags' || c.operation === 'AddTags') && c.variables.id === order.id);
      expect(tagCalls, String(number)).toEqual([]);
      expect(state.calls.filter((c) => c.operation === 'SetOrderStatus' && (c.variables.metafields as { ownerId: string }[])[0]?.ownerId === order.id)).toEqual([]);
    }
    // and both still show up where Maks's AI looks
    const stale = (await (await request.get('/api/stale')).json()) as { orders: { order: { number: string }; stale_reason: string }[] };
    for (const number of [ORDERS.taggedNeverSet, ORDERS.malformedStatus]) {
      expect(stale.orders.find((o) => o.order.number === String(number))?.stale_reason, String(number)).toBe('never_set');
    }
  });

  test('bulk write by Claude with a label default, then the derived metafields match', async ({ request }) => {
    const res = await request.post(`/api/orders/${ORDERS.staleInProduction}`, {
      data: { items: { '60000000000001': 'Final Polishing', '60000000000002': null } },
      headers: bearer(CLAUDE_TOKEN),
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = (await res.json()) as { items: Record<string, unknown>[]; summary: string; last_updated_by: string };
    expect(body.items[0]).toMatchObject({ status: 'final_polishing', updated_by: 'claude', via: 'token:claude' });
    expect(body.items[1]).toMatchObject({ status: null, updated_by: 'claude' });
    expect(body.summary).toMatch(/^0\/2 done · Final Polishing ×1 · Not set ×1 — claude, /);
    const order = mockOrder(await mockState(request), ORDERS.staleInProduction);
    expect(order.metafields['trax_production.summary']!.value).toBe(body.summary);
    expect(order.metafields['trax_production.last_updated_by']!.value).toBe('claude');
  });

  test('no response contains pin_hash; health reports the served version', async ({ request }) => {
    for (const path of ['/api/statuses', `/api/orders/${ORDERS.staleInProduction}`, '/api/orders', '/api/stale', '/api/health']) {
      const text = await (await request.get(path, { headers: bearer(CLAUDE_TOKEN) })).text();
      expect(text, path).not.toContain('pin_hash');
    }
    const health = (await (await request.get('/api/health')).json()) as Record<string, unknown>;
    // throttle = the Shopify cost bucket from the last response (SPEC §8), so a deploy can check the plan it runs on
    expect(health).toEqual({ ok: true, shop: 'Mock TraxNYC', api_version: '2026-10', served_api_version: '2026-10', scopes_ok: true, throttle: { maximum_available: 2000, restore_rate: 100 } });
    const res = await request.get('/api/health');
    expect(res.headers()['x-content-type-options']).toBe('nosniff');
    expect(res.headers()['x-frame-options']).toBe('DENY');
    expect(res.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers()['strict-transport-security']).toContain('max-age=31536000');
  });

  test('/api/health is memoised: repeated anonymous hits do not reach Shopify', async ({ request }) => {
    await seedExtra(request, { clear_calls: true });
    for (let i = 0; i < 5; i++) expect((await request.get('/api/health')).status()).toBe(200);
    const state = await mockState(request);
    const shopifyCalls = state.calls.filter((c) => c.operation === 'ShopInfo' || c.operation === 'AccessScopes');
    expect(shopifyCalls.length).toBeLessThanOrEqual(2); // at most one (ShopInfo + AccessScopes) pair, usually none
  });

  test('/llms.txt is plain text for agents', async ({ request }) => {
    const res = await request.get('/llms.txt');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('text/plain');
    expect(await res.text()).toContain('GET /api/stale');
  });
});
