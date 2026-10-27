import { expect, test } from '@playwright/test';
import { ORDERS, STAFF } from './fixtures';
import { loginAs, mockOrder, mockState, seedAll, seedExtra } from './helpers';

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

    await item.locator('select.select-status').selectOption('cad');
    await expect(page.getByTestId('last-updated-50788056399960')).toContainText(/Last updated \w{3} \d{1,2}, \d{1,2}:\d{2} [AP]M by Ahmed/);
    await expect(page.getByTestId('order-last-updated')).toContainText('by Ahmed');

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

    // a second write carries the digest from the read
    await item.locator('select.select-status').selectOption('mold');
    await expect(page.getByTestId('last-updated-50788056399960')).toContainText('by Ahmed');
    const after = await mockState(request);
    const second = after.calls.filter((c) => c.operation === 'SetOrderStatus').at(-1)!;
    const digest = (second.variables.metafields as { key: string; compareDigest?: string | null }[]).find((m) => m.key === 'item_status')!.compareDigest;
    expect(typeof digest).toBe('string');
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
});
