import { expect, test } from '@playwright/test';
import { CLAUDE_TOKEN, ORDERS } from './fixtures';
import { loginAs, refreshList, seedAll } from './helpers';

test.describe('home', () => {
  test.beforeAll(async ({ request }) => {
    await seedAll(request);
    await refreshList(request, CLAUDE_TOKEN);
  });

  test('search box opens the order page (accepts #251548)', async ({ page }) => {
    await page.goto('/');
    const box = page.getByLabel('Find an order');
    await expect(box).toBeFocused();
    await expect(box).toHaveAttribute('inputmode', 'numeric');
    await box.fill(`#${ORDERS.neverSet}`);
    await box.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/orders/${ORDERS.neverSet}$`));
    await expect(page.getByRole('heading', { name: `Order #${ORDERS.neverSet}` })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Production Status by Product' })).toBeVisible();
  });

  test('lists show never-set and in-production orders, stalest first, without shipped or untracked ones', async ({ page }) => {
    await page.goto('/');
    const neverSet = page.getByTestId(`row-${ORDERS.neverSet}`);
    await expect(neverSet).toBeVisible();
    await expect(neverSet).toContainText('No status yet');
    await expect(page.getByTestId(`row-${ORDERS.watchNeverSet}`)).toBeVisible();

    const stale = page.getByTestId(`row-${ORDERS.staleInProduction}`);
    await expect(stale).toBeVisible();
    await expect(stale).toContainText('2/2 items');
    await expect(stale).toContainText('CAD ×1 · Polishing ×1 — Igor');
    await expect(stale.getByText('stale', { exact: true })).toBeVisible();
    await expect(stale).toContainText('by Igor');

    const fresh = page.getByTestId(`row-${ORDERS.freshInProduction}`);
    await expect(fresh).toBeVisible();
    await expect(fresh.getByText('stale', { exact: true })).toHaveCount(0);
    await expect(page.getByTestId(`row-${ORDERS.stillHere}`).getByText('waiting', { exact: true })).toBeVisible();

    await expect(page.getByTestId(`row-${ORDERS.shipped}`)).toHaveCount(0);
    await expect(page.getByTestId(`row-${ORDERS.untracked}`)).toHaveCount(0);

    // stalest first inside "In production": the 7-day-old order before the 1-hour-old one
    const numbers = await page.locator('[data-testid^="row-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
    expect(numbers.indexOf(`row-${ORDERS.staleInProduction}`)).toBeLessThan(numbers.indexOf(`row-${ORDERS.freshInProduction}`));
    expect(numbers.indexOf(`row-${ORDERS.watchNeverSet}`)).toBeLessThan(numbers.indexOf(`row-${ORDERS.neverSet}`));
  });

  test('recent chips remember opened orders on this device', async ({ page }) => {
    await page.goto(`/orders/${ORDERS.freshInProduction}`);
    await page.goto('/');
    await expect(page.getByRole('link', { name: `#${ORDERS.freshInProduction}` }).first()).toBeVisible();
  });

  test('phone viewport (390 px) renders the home and order pages without horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAs(page, 'ahmed');
    for (const url of ['/', `/orders/${ORDERS.mobile}`, `/orders/${ORDERS.staleInProduction}`, '/login', '/agents']) {
      await page.goto(url);
      const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth, body: document.body.scrollWidth }));
      expect(widths.scroll, url).toBeLessThanOrEqual(widths.client);
      expect(widths.body, url).toBeLessThanOrEqual(390);
    }
    await page.goto(`/orders/${ORDERS.mobile}`);
    const select = page.locator('select.select-status').nth(1);
    const box = await select.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(55);
    expect((box?.width ?? 0) + (box?.x ?? 0)).toBeLessThanOrEqual(390);
  });
});
