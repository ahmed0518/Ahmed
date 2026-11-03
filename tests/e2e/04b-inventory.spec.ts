import { expect, test } from '@playwright/test';
import { CLAUDE_TOKEN } from './fixtures';
import { NO_ADMIN_URL, bearer, originHeader, seedAll, sessionAs } from './helpers';

test.describe('inventory', () => {
  test.beforeAll(async ({ request }) => {
    await seedAll(request);
  });

  test('needs a login; 404 where no store is configured', async ({ page, request }) => {
    const anon = await request.get('/api/inventory');
    expect(anon.status()).toBe(401);
    await page.goto('/inventory');
    await expect(page).toHaveURL(/\/login\?next=%2Finventory$/);
    const off = await request.get(`${NO_ADMIN_URL}/inventory`);
    expect(off.status()).toBe(404);
    const offApi = await request.get(`${NO_ADMIN_URL}/api/inventory`, { headers: bearer(CLAUDE_TOKEN) });
    expect(offApi.status()).toBe(404);
    expect((await offApi.json()).code).toBe('inventory_disabled');
  });

  test('the four tiles, the tables and a slip added by hand', async ({ page }) => {
    await sessionAs(page, 'ahmed');
    await page.goto('/inventory');
    await expect(page.getByRole('heading', { name: 'TRAX Inventory' })).toBeVisible();
    await expect(page.getByTestId('tile-diamond')).toContainText('386.45 ct');
    await expect(page.getByTestId('tile-diamond')).toContainText('$125,995');
    await expect(page.getByTestId('tile-casting')).toContainText('389 pcs');
    await expect(page.getByTestId('tile-scrap')).toContainText('382.3 g');
    await expect(page.getByTestId('tile-metal')).toContainText('nothing this month'); // the export ends in October

    // diamonds: tap a grade for its sizes
    await page.getByTestId('tile-diamond').click();
    await expect(page.getByRole('heading', { name: /^Diamonds/ })).toBeVisible();
    await page.getByTestId('diamond-group-SI').click();
    await expect(page.locator('table.inv-inner')).toContainText('$280');
    await expect(page.locator('tr.inv-total')).toContainText('386.45');

    // scrap: on hand since the cutover; the 2025 lock-box rows are not counted
    await page.getByTestId('tile-scrap').click();
    await expect(page.getByTestId('scrap-row-14KY')).toContainText('139.48');
    await expect(page.locator('tr.inv-total')).toContainText('382.32');

    // gold dust: who still owes a slip today, then add one by hand
    await page.getByTestId('tile-metal').click();
    await expect(page.getByTestId('missing-today')).toContainText('no slips in yet — missing Chaerin, Mr. Sim, Mr. Kim');
    await page.getByRole('button', { name: 'All time' }).click();
    await expect(page.getByTestId('metal-row-Chaerin')).toContainText('95.8');
    await page.getByRole('button', { name: 'Add by hand' }).click();
    const review = page.getByTestId('review');
    await expect(review.getByRole('heading', { name: 'New slip: Gold dust at bench' })).toBeVisible();
    await review.getByLabel('Jeweler').fill('Chaerin');
    await review.getByLabel('Item / order # 1').fill('251900 (Rina)');
    await review.getByLabel('Qty 1').fill('2');
    await review.getByLabel('Before g 1').fill('8,7');
    await review.getByLabel('After g 1').fill('7.8');
    await review.getByLabel('Dust / filings given back (g)').fill('0.5');
    await review.getByLabel('Note').fill('e2e slip');
    await review.getByRole('button', { name: 'Save slip' }).click();
    await expect(page.getByRole('status')).toContainText('Saved');
    await expect(page.getByTestId('missing-today')).toContainText('in from Chaerin · still missing Mr. Sim, Mr. Kim');
    const row = page.locator('.inv-slip').first();
    await expect(row).toContainText('Chaerin');
    await expect(row).toContainText('8.7 → 7.8 g');
    await expect(row).toContainText('1 line · note');
    await row.getByRole('button').first().click();
    await expect(row).toContainText('Dust returned: 0.5 g');
    await expect(row).toContainText('Saved by Ahmed');

    // delete asks first
    await row.getByRole('button', { name: 'Delete' }).click();
    await row.getByRole('button', { name: 'Keep' }).click();
    await expect(row.getByRole('button', { name: 'Delete' })).toBeVisible();
    await row.getByRole('button', { name: 'Delete' }).click();
    await row.getByRole('button', { name: 'Yes, delete' }).click();
    await expect(page.getByRole('status')).toContainText('Deleted');
    await expect(page.getByTestId('missing-today')).toContainText('no slips in yet');

    // owner cards
    await expect(page.getByRole('heading', { name: /^Jewelers/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /^People/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /^monday\.com/ })).toContainText('Not connected');
  });

  test('phone viewport: no horizontal scroll, every tap target at least 44 px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await sessionAs(page, 'ahmed');
    await page.goto('/inventory');
    await page.getByTestId('tile-metal').click();
    await page.getByRole('button', { name: 'Add by hand' }).click();
    await expect(page.getByTestId('review')).toBeVisible();
    const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    expect(widths.scroll).toBeLessThanOrEqual(widths.client);
    const small = await page.locator('a[href], button, select, input, textarea').evaluateAll((els) =>
      els
        .filter((el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden')
        .map((el) => ({ tag: el.tagName.toLowerCase(), text: (el.textContent ?? el.getAttribute('aria-label') ?? '').trim().slice(0, 30), height: el.getBoundingClientRect().height }))
        .filter((t) => t.height < 44),
    );
    expect(small).toEqual([]);
  });

  test('API: an agent token reads the sections and writes a slip; the sync and scan endpoints say what is missing', async ({ request }) => {
    const all = await request.get('/api/inventory', { headers: bearer(CLAUDE_TOKEN) });
    expect(all.status()).toBe(200);
    const body = (await all.json()) as { viewer: { can_write: boolean; sections: string[] }; slips: { id: string }[]; tiles: { diamond: { ct: number } }; settings: { jewelers: string[] } };
    expect(body.viewer).toMatchObject({ can_write: true, sections: ['metal', 'diamond', 'scrap', 'casting'] });
    expect(body.slips.length).toBeGreaterThanOrEqual(93);
    expect(body.tiles.diamond.ct).toBeCloseTo(386.45, 2);
    expect(body.settings.jewelers).toEqual(['Chaerin', 'Mr. Sim', 'Mr. Kim']);
    const onlyScrap = await request.get('/api/inventory?kind=scrap', { headers: bearer(CLAUDE_TOKEN) });
    expect(((await onlyScrap.json()) as { slips: { kind: string }[] }).slips.every((s) => s.kind === 'scrap')).toBe(true);
    expect((await request.get('/api/inventory?kind=rings', { headers: bearer(CLAUDE_TOKEN) })).status()).toBe(400);

    const created = await request.post('/api/inventory/slips', {
      headers: bearer(CLAUDE_TOKEN),
      data: { kind: 'scrap', who: 'Jalgas', date: '2026-11-03', dir: 'out', to: 'Refinery', lines: [{ what: 'lot', karat: '14ky', grams: 10, value: null }], note: 'via api' },
    });
    expect(created.status(), await created.text()).toBe(201);
    const slip = ((await created.json()) as { slip: { id: string; createdBy: string; source: string } }).slip;
    expect(slip.createdBy).toBe('token:claude');
    expect(slip.source).toBe('manual');
    const bad = await request.post('/api/inventory/slips', { headers: bearer(CLAUDE_TOKEN), data: { kind: 'scrap', date: '2026-11-03', lines: [{ what: 'x', grams: 'ten' }] } });
    expect(bad.status()).toBe(400);
    expect((await bad.json()).code).toBe('invalid_slip');
    const gone = await request.delete(`/api/inventory/slips/${slip.id}`, { headers: bearer(CLAUDE_TOKEN) });
    expect(gone.status()).toBe(200);
    expect((await request.delete(`/api/inventory/slips/${slip.id}`, { headers: bearer(CLAUDE_TOKEN) })).status()).toBe(404);

    const sync = await request.post('/api/inventory/sync', { headers: bearer(CLAUDE_TOKEN), data: { boards: ['dust'] } });
    expect(sync.status()).toBe(207);
    const res = (await sync.json()) as { ok: boolean; results: { board: string; ok: boolean; error: string }[] };
    expect(res.ok).toBe(false);
    expect(res.results[0]).toMatchObject({ board: 'dust', ok: false, error: expect.stringMatching(/MONDAY_API_TOKEN/) });
    const noCron = await request.post('/api/inventory/sync', { headers: { ...originHeader() } });
    expect(noCron.status()).toBe(401);

    const scan = await request.post('/api/inventory/scan', { headers: { Authorization: `Bearer ${CLAUDE_TOKEN}` }, multipart: { kind: 'metal', image: { name: 'slip.png', mimeType: 'image/png', buffer: Buffer.from('not really a png') } } });
    expect(scan.status()).toBe(503);
    expect((await scan.json()).code).toBe('scan_unavailable');
  });

  test('the owner narrows a person to one section, view only', async ({ page, browser, request }) => {
    await sessionAs(page, 'ahmed');
    await page.goto('/inventory');
    const igor = page.getByTestId('person-igor');
    await expect(igor).toContainText('everything · can save');
    for (const chip of ['Gold dust', 'Scrap', 'Castings', 'Can save']) {
      await igor.getByRole('button', { name: `Igor: ${chip}` }).click();
      await expect(page.getByRole('status')).toContainText('Access updated');
    }
    await expect(igor).toContainText('Diamonds · view only');

    const other = await browser.newContext();
    const asIgor = await other.newPage();
    await sessionAs(asIgor, 'igor');
    await asIgor.goto('/inventory');
    await expect(asIgor.getByTestId('tile-diamond')).toBeVisible();
    await expect(asIgor.getByTestId('tile-metal')).toHaveCount(0);
    await expect(asIgor.getByRole('button', { name: 'Add by hand' })).toHaveCount(0);
    await expect(asIgor.locator('.inv-status')).toHaveText('View only');
    const denied = await asIgor.request.post('/api/inventory/slips', { headers: originHeader(), data: { kind: 'diamond', date: '2026-11-03', lines: [{ quality: 'SI', carats: 1 }] } });
    expect(denied.status()).toBe(403);
    const outside = await asIgor.request.get('/api/inventory?kind=metal', { headers: originHeader() });
    expect(((await outside.json()) as { slips: unknown[] }).slips).toHaveLength(0);
    await other.close();

    // put it back for whoever runs next
    const reset = await request.put('/api/inventory/settings', { headers: bearer(CLAUDE_TOKEN), data: { access: {} } });
    expect(reset.status()).toBe(403); // a token is not an owner
    await igor.getByRole('button', { name: 'Igor: Can save' }).click();
    for (const chip of ['Gold dust', 'Scrap', 'Castings']) await igor.getByRole('button', { name: `Igor: ${chip}` }).click();
    await expect(igor).toContainText('everything · can save');
  });
});
