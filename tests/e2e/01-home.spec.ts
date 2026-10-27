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
    // no item_status → no visible_ids: the row counts Shopify lines (warranty included) and never claims "0/3 items"
    await expect(neverSet).toContainText('3 lines');
    await expect(neverSet).not.toContainText('/3');
    await expect(page.getByTestId(`row-${ORDERS.watchNeverSet}`)).toBeVisible();
    await expect(page.getByTestId(`row-${ORDERS.watchNeverSet}`)).toContainText('1 line');
    // hand-tagged orders without a status stay in the chase list
    await expect(page.getByTestId(`row-${ORDERS.taggedNeverSet}`)).toBeVisible();

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
      // the header nav never wraps "Log in" / "Log out" onto a second line
      const nav = await page.locator('.site-header__nav').boundingBox();
      expect(nav?.height, url).toBeLessThanOrEqual(48);
      // SPEC §6: below 480 px the Agents link is hidden so the brand and the staff name fit — no "Trax Pro…"
      await expect(page.locator('.site-header__agents'), url).toBeHidden();
      const brand = await page.locator('.site-header__brand').evaluate((el) => ({ width: el.getBoundingClientRect().width, truncated: el.scrollWidth > el.clientWidth, font: getComputedStyle(el).fontSize }));
      expect(brand.font, url).toBe('15px');
      expect(brand.truncated, url).toBe(false);
      expect(brand.width, url).toBeGreaterThanOrEqual(150);
    }
    await page.goto(`/orders/${ORDERS.mobile}`);
    const select = page.locator('select.select-status').nth(1);
    const box = await select.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(55);
    expect((box?.width ?? 0) + (box?.x ?? 0)).toBeLessThanOrEqual(390);

    // tap targets: every button, note input, disclosure and chip is at least 44 px tall
    const stillHere = await page.getByRole('button', { name: 'Still here' }).first().boundingBox();
    expect(stillHere?.height).toBeGreaterThanOrEqual(44);
    const note = await page.getByLabel('Note for Second Item').boundingBox();
    expect(note?.height).toBeGreaterThanOrEqual(44);
    const history = await page.locator('details summary').first().boundingBox();
    expect(history?.height).toBeGreaterThanOrEqual(44);
    const logout = await page.getByRole('button', { name: 'Log out' }).first().boundingBox();
    expect(logout?.height).toBeGreaterThanOrEqual(44);
    await page.goto('/');
    await expect(page.locator('.chip').first()).toBeVisible();
    const chip = await page.locator('.chip').first().boundingBox();
    expect(chip?.height).toBeGreaterThanOrEqual(44);

    // SPEC §6 / §11: EVERY tap target — links (header, inline action links), buttons, selects,
    // inputs, disclosures and chips — is at least 44 px tall, logged in and logged out
    const pages = ['/', `/orders/${ORDERS.mobile}`, `/orders/${ORDERS.staleInProduction}`, `/orders/${ORDERS.untracked}`, '/login', '/agents', '/no-such-page'];
    for (const loggedIn of [true, false]) {
      if (!loggedIn) await page.context().clearCookies();
      for (const url of pages) {
        await page.goto(url);
        const small = await page.locator('a[href], button, select, input, summary, .chip').evaluateAll((els) =>
          els
            .filter((el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden')
            .map((el) => ({ tag: el.tagName.toLowerCase(), text: (el.textContent ?? '').trim().slice(0, 30), height: el.getBoundingClientRect().height }))
            .filter((t) => t.height < 44),
        );
        expect(small, `${url} (${loggedIn ? 'logged in' : 'logged out'})`).toEqual([]);
      }
    }
  });
});
