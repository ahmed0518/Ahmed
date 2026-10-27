import { expect, test } from '@playwright/test';
import { ORDERS, STAFF } from './fixtures';
import { NO_ADMIN_URL, loginAs, mockOrder, mockStaff, mockState, originHeader, seedAll, seedExtra } from './helpers';

test.describe('order page updates', () => {
  test.beforeAll(async ({ request }) => {
    await seedAll(request);
  });

  test('login with name + PIN through the form returns to the order', async ({ page }) => {
    await page.goto(`/login?next=/orders/${ORDERS.neverSet}`);
    const pin = page.getByLabel('PIN');
    await expect(pin).toHaveAttribute('inputmode', 'numeric');
    await expect(pin).toHaveAttribute('autocomplete', 'off');
    await page.getByLabel('Your name').selectOption('ahmed');
    await pin.fill('0000');
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.locator('#login-error')).toContainText('Wrong name or PIN');
    await pin.fill(STAFF[0]!.pin);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page).toHaveURL(new RegExp(`/orders/${ORDERS.neverSet}$`));
    await expect(page.getByText('Updating as Ahmed')).toBeVisible();
  });

  test('changing a status shows who/when and writes metafieldsSet (compareDigest) + tagsAdd', async ({ page, request }) => {
    await loginAs(page, 'ahmed');
    await page.goto(`/orders/${ORDERS.neverSet}`);
    await expect(page.getByText('Ships by Fri, Oct 30')).toBeVisible();
    await expect(page.getByText('1 non-production item hidden')).toBeVisible();
    const item = page.getByTestId('item-50788056399960');
    await expect(item.locator('.pill')).toHaveText('14K Gold 20 Pt Lab Diamond Tennis Bracelet 71679 — Yellow Gold / 8 Inches');
    await expect(page.getByTestId('item-50788056432728').locator('.pill')).toHaveText('14K Gold 20 Pt Lab Diamond Tennis Bracelet 71679 — Yellow Gold / 7 Inches');
    await expect(page.getByTestId('last-updated-50788056399960')).toHaveText('Not set yet');
    // never set: one summary line, no contradictory "No status set yet" under it
    await expect(page.getByTestId('order-summary')).toContainText('No status yet');
    await expect(page.getByTestId('order-summary')).toContainText('stale');
    await expect(page.getByTestId('order-last-updated')).toHaveCount(0);
    await expect(page.getByText('No status set yet')).toHaveCount(0);

    await item.locator('select.select-status').selectOption('cad');
    await expect(page.getByTestId('last-updated-50788056399960')).toContainText(/Last updated \w{3} \d{1,2}, \d{1,2}:\d{2} [AP]M by Ahmed/);
    // the order-level header follows the write without a reload
    await expect(page.getByTestId('order-last-updated')).toContainText(/Last updated \w{3} \d{1,2}, \d{1,2}:\d{2} [AP]M by Ahmed/);
    await expect(page.getByTestId('order-summary')).toContainText('0/2 done · CAD ×1 · Not set ×1 — Ahmed');
    // the updated item is fresh, but the order stays stale: its other item has had no status since the order date
    await expect(item.locator('.badge--stale')).toHaveCount(0);
    await expect(page.getByTestId('order-summary')).toContainText('stale');

    const state = await mockState(request);
    const order = mockOrder(state, ORDERS.neverSet);
    const stored = JSON.parse(order.metafields['trax_production.item_status']!.value) as { v: number; visible_ids: string[]; items: Record<string, { status: string; updated_by: string; source: string; via: string; history: { kind: string }[] }> };
    expect(stored.v).toBe(1);
    expect(stored.visible_ids).toEqual(['50788056399960', '50788056432728']);
    expect(stored.items['50788056399960']).toMatchObject({ status: 'cad', updated_by: 'Ahmed', source: 'web', via: 'web:Ahmed' });
    expect(stored.items['50788056399960']!.history[0]!.kind).toBe('set');
    expect(order.metafields['trax_production.last_updated_by']!.value).toBe('Ahmed');
    expect(order.metafields['trax_production.summary']!.value).toMatch(/^0\/2 done · CAD ×1 · Not set ×1 — Ahmed, /);
    expect(order.metafields['trax_production.last_updated_at']!.value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(order.tags).toContain('trax-production');

    const writes = state.calls.filter((c) => c.operation === 'SetOrderStatus');
    expect(writes.length).toBeGreaterThanOrEqual(1);
    const entries = (writes.at(-1)!.variables.metafields as { key: string; compareDigest?: string | null }[]);
    const itemStatusEntry = entries.find((m) => m.key === 'item_status')!;
    expect('compareDigest' in itemStatusEntry).toBe(true);
    expect(itemStatusEntry.compareDigest).toBeNull(); // first write: explicit null
    expect(entries.map((m) => m.key).sort()).toEqual(['item_status', 'last_updated_at', 'last_updated_by', 'summary']);
    expect(state.calls.some((c) => c.operation === 'AddTags' && (c.variables.tags as string[]).includes('trax-production'))).toBe(true);

    // a second write carries the digest from the read, and a note typed before picking the
    // status travels with that save (then the field clears — nothing typed is dropped silently)
    const note = item.getByLabel('Note for 14K Gold 20 Pt Lab Diamond Tennis Bracelet 71679 — Yellow Gold / 8 Inches');
    await note.fill('ring sized to 7');
    await item.locator('select.select-status').selectOption('mold');
    await expect(note).toHaveValue('');
    await expect(page.getByTestId('last-updated-50788056399960')).toContainText('by Ahmed');
    const after = await mockState(request);
    const second = after.calls.filter((c) => c.operation === 'SetOrderStatus').at(-1)!;
    const digest = (second.variables.metafields as { key: string; compareDigest?: string | null }[]).find((m) => m.key === 'item_status')!.compareDigest;
    expect(typeof digest).toBe('string');
    const storedAfter = JSON.parse(mockOrder(after, ORDERS.neverSet).metafields['trax_production.item_status']!.value) as { items: Record<string, { status: string; history: { kind: string; status: string | null; note: string }[] }> };
    expect(storedAfter.items['50788056399960']!.history.at(-1)).toMatchObject({ kind: 'set', status: 'mold', note: 'ring sized to 7' });
  });

  test('"Still here" appends a confirm entry without changing the status', async ({ page, request }) => {
    await loginAs(page, 'igor');
    await page.goto(`/orders/${ORDERS.stillHere}`);
    const item = page.getByTestId('item-60000000000071');
    await expect(item.locator('select.select-status')).toHaveValue('waiting_for_dia');
    await item.getByLabel('Note for Cross Pendant').fill('stones arrive Friday');
    await item.getByRole('button', { name: 'Still here' }).click();
    await expect(page.getByTestId('last-updated-60000000000071')).toContainText('by Igor');
    await expect(item.locator('select.select-status')).toHaveValue('waiting_for_dia');
    await item.getByText(/History \(2\)/).click();
    await expect(item.locator('.history li').first()).toContainText('Still here');
    await expect(item.locator('.history li').first()).toContainText('stones arrive Friday');

    const order = mockOrder(await mockState(request), ORDERS.stillHere);
    const stored = JSON.parse(order.metafields['trax_production.item_status']!.value) as { items: Record<string, { status: string; history: { kind: string; note: string }[] }> };
    const e = stored.items['60000000000071']!;
    expect(e.status).toBe('waiting_for_dia');
    expect(e.history.at(-1)).toMatchObject({ kind: 'confirm', note: 'stones arrive Friday' });
  });

  test('setting every item to a done status removes the trax-production tag', async ({ page, request }) => {
    await loginAs(page, 'ahmed');
    await page.goto(`/orders/${ORDERS.allDone}`);
    await page.getByLabel('Set all 2 items to').selectOption('sent_to_store');
    await expect(page.getByText('All 2 items set to Sent to Store')).toBeVisible();
    await expect(page.getByTestId('item-60000000000061').locator('select.select-status')).toHaveValue('sent_to_store');
    await expect(page.getByTestId('order-summary')).toContainText('2/2 done');
    await expect(page.getByTestId('order-summary').getByText('done', { exact: true })).toBeVisible();
    const state = await mockState(request);
    expect(mockOrder(state, ORDERS.allDone).tags).not.toContain('trax-production');
    expect(state.calls.some((c) => c.operation === 'RemoveTags')).toBe(true);
    expect(state.calls.filter((c) => c.operation === 'SetOrderStatus').length).toBeGreaterThanOrEqual(1);
  });

  test('a STALE_OBJECT answer is retried and the write still succeeds', async ({ page, request }) => {
    await seedExtra(request, { failures: [{ operation: 'SetOrderStatus', kind: 'STALE_OBJECT' }], clear_calls: true });
    await loginAs(page, 'ahmed');
    await page.goto(`/orders/${ORDERS.staleObjectRetry}`);
    await page.getByTestId('item-60000000000051').locator('select.select-status').selectOption('mold');
    await expect(page.getByTestId('last-updated-60000000000051')).toContainText('by Ahmed');
    const state = await mockState(request);
    const writes = state.calls.filter((c) => c.operation === 'SetOrderStatus');
    expect(writes.map((w) => w.outcome)).toEqual(['STALE_OBJECT', 'ok']);
    expect(state.failures).toEqual([]);
    const stored = JSON.parse(mockOrder(state, ORDERS.staleObjectRetry).metafields['trax_production.item_status']!.value) as { items: Record<string, { status: string }> };
    expect(stored.items['60000000000051']!.status).toBe('mold');
  });

  test('a removed line (currentQuantity 0) is collapsed and read-only', async ({ page }) => {
    await loginAs(page, 'ahmed');
    await page.goto(`/orders/${ORDERS.removedLine}`);
    await expect(page.getByTestId('item-60000000000021')).toBeVisible();
    await expect(page.getByTestId('item-60000000000022')).toHaveCount(0);
    const removed = page.getByTestId('removed-items');
    await expect(removed).toContainText('1 removed item');
    await removed.locator('summary').click();
    await expect(removed).toContainText('Removed Pendant — Polishing (read-only, removed from the order)');
    await expect(removed.locator('select')).toHaveCount(0);
  });

  test('not logged in: selects are disabled with a log-in link and no history is shown', async ({ page }) => {
    await page.goto(`/orders/${ORDERS.staleInProduction}`);
    await expect(page.getByRole('link', { name: 'Log in to update' })).toBeVisible();
    await expect(page.getByTestId('item-60000000000001').locator('select.select-status')).toBeDisabled();
    await expect(page.getByText('History (')).toHaveCount(0);
    await expect(page.getByText('Open in Shopify')).toHaveCount(0);
  });

  test('a failed single save shows its error until a later bulk write succeeds, then it is gone', async ({ page, request }) => {
    await loginAs(page, 'ahmed');
    await page.goto(`/orders/${ORDERS.mobile}`); // the first read repairs derived metafields; arm the failure after it
    const item = page.getByTestId('item-60000000000092');
    await expect(item.locator('select.select-status')).toHaveValue('');
    await seedExtra(request, { failures: [{ operation: 'SetOrderStatus', kind: 'HTTP_500' }], clear_calls: true });

    await item.locator('select.select-status').selectOption('casting');
    await expect(item.locator('.notice--error')).toContainText('Shopify request failed');
    await expect(item.locator('select.select-status')).toHaveValue(''); // rolled back
    // a mutation is never re-sent after a 5xx: exactly one SetOrderStatus reached the mock
    const failed = await mockState(request);
    expect(failed.calls.filter((c) => c.operation === 'SetOrderStatus').map((c) => c.outcome)).toEqual(['HTTP_500']);
    expect(failed.failures).toEqual([]);

    await page.getByLabel('Set all 2 items to').selectOption('polishing');
    await expect(page.getByText('All 2 items set to Polishing')).toBeVisible();
    await expect(item.locator('select.select-status')).toHaveValue('polishing');
    await expect(item.locator('.notice--error')).toHaveCount(0);
    await expect(page.getByTestId('order-summary')).toContainText('Polishing ×2');
  });

  test('visiting the home page keeps the session: logging out is a POST button, never a prefetchable link', async ({ page, request }) => {
    await loginAs(page, 'ahmed');
    await page.goto('/');
    await expect(page.getByText('Logged in as Ahmed')).toBeVisible();
    await page.waitForTimeout(1000); // give any <Link> prefetch time to fire
    await page.goto(`/orders/${ORDERS.freshInProduction}`);
    await expect(page.getByText('Updating as Ahmed')).toBeVisible();
    expect((await page.context().cookies()).some((c) => c.name === 'trax_staff')).toBe(true);

    // a bare GET cannot clear the cookie (405: the route only has POST), nor can a cross-site POST (403)
    const get = await page.request.get('/logout', { maxRedirects: 0 });
    expect(get.status()).toBe(405);
    const crossSite = await page.request.post('/logout', { maxRedirects: 0, headers: { Origin: 'https://evil.test' } });
    expect(crossSite.status()).toBe(403);
    expect((await page.context().cookies()).some((c) => c.name === 'trax_staff')).toBe(true);

    // a same-origin POST answers 303 with a RELATIVE Location: the standalone server only knows
    // its bind address, so an absolute URL would send a Docker deploy's staff to localhost
    // (sent from the cookie-less context, so the page's own session stays for the step below)
    const out = await request.post('/logout', { maxRedirects: 0, headers: originHeader() });
    expect(out.status()).toBe(303);
    expect(out.headers()['location']).toBe('/login');
    expect(out.headers()['set-cookie']).toContain('trax_staff=');

    // the header shows the session, and its Log out button ends it
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Log in' })).toHaveCount(0);
    await page.locator('.site-header__nav').getByRole('button', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect((await page.context().cookies()).some((c) => c.name === 'trax_staff')).toBe(false);
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Log in' }).first()).toBeVisible();
    await expect(page.getByText('Logged in as Ahmed')).toHaveCount(0);
  });

  test('a logged-in page during a Shopify outage shows the error notice, never a bare 500', async ({ page, request }) => {
    // The passcode-less app copy shares the mock, the SESSION_SECRET and (same host, ports are
    // not part of cookie scope) the browser's cookie — and nothing has made it read the shop
    // metafields yet, so its 30 s cache is cold and the roster lookup behind the cookie really
    // reaches Shopify. Each render reads them up to three times (header, page, settings), a
    // prefetched <Link> renders the header again, and every read retries a 5xx three times:
    // arm far more failures than that and clear the rest. Igor, not Ahmed: the login limiter
    // allows 10 per name per minute and the earlier tests use most of Ahmed's.
    await loginAs(page, 'igor');
    await seedExtra(request, { failures: Array.from({ length: 60 }, () => ({ operation: 'ShopSettings', kind: 'HTTP_500' })) });
    try {
      const home = await page.goto(`${NO_ADMIN_URL}/`);
      expect(home?.status()).toBe(200);
      await expect(page.locator('.notice--error')).toContainText('Shopify may be slow');
      await expect(page.getByRole('heading', { name: 'In production' })).toBeVisible();

      const order = await page.goto(`${NO_ADMIN_URL}/orders/${ORDERS.staleInProduction}`);
      expect(order?.status()).toBe(200);
      await expect(page.getByRole('heading', { name: `Order #${ORDERS.staleInProduction}` })).toBeVisible();
      await expect(page.locator('.notice--error')).toContainText('Shopify request failed. Try again in a moment.');
    } finally {
      await seedExtra(request, { clear_failures: true });
    }
    expect((await mockState(request)).failures).toEqual([]);
  });

  test('parallel wrong PINs are all counted: the lock lands on the 5th and the right PIN is refused while locked', async ({ request }) => {
    const lena = STAFF.find((s) => s.id === 'lena')!;
    const burst = await Promise.all(Array.from({ length: 8 }, () => request.post('/api/login', { data: { id: 'lena', pin: '0000' }, headers: originHeader() })));
    const statuses = burst.map((r) => r.status()).sort();
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429, 429, 429]);
    const bodies = await Promise.all(burst.map((r) => r.json() as Promise<{ code: string }>));
    expect(bodies.filter((b) => b.code === 'locked')).toHaveLength(3);

    const stored = mockStaff(await mockState(request)).find((s) => s.id === 'lena')!;
    expect(stored.failed_attempts).toBe(5);
    expect(stored.locked_until).not.toBeNull();

    const right = await request.post('/api/login', { data: { id: 'lena', pin: lena.pin }, headers: originHeader() });
    expect(right.status()).toBe(429);
    expect(right.headers()['retry-after']).toMatch(/^\d+$/);
    expect((await right.json()).code).toBe('locked');
    expect(await right.text()).not.toContain('pin_hash');
  });
});
