import { expect, test } from '@playwright/test';
import { ADMIN_PASSCODE } from './fixtures';
import { NO_ADMIN_URL, mockState, originHeader, seedAll } from './helpers';

test.describe('admin', () => {
  test.beforeAll(async ({ request }) => {
    await seedAll(request);
  });

  test('/admin answers 404 when ADMIN_PASSCODE is empty', async ({ request }) => {
    const page = await request.get(`${NO_ADMIN_URL}/admin`);
    expect(page.status()).toBe(404);
    const login = await request.post(`${NO_ADMIN_URL}/api/admin/login`, { data: { passcode: ADMIN_PASSCODE }, headers: { ...originHeader(), Origin: NO_ADMIN_URL } });
    expect(login.status()).toBe(404);
    // the same build with a passcode serves the form
    const withPasscode = await request.get('/admin');
    expect(withPasscode.status()).toBe(200);
    expect(await withPasscode.text()).toContain('Passcode');
  });

  test('wrong passcode → 401, right passcode → settings and roster without pin_hash', async ({ page, request }) => {
    const wrong = await page.request.post('/api/admin/login', { data: { passcode: 'definitely-not-it-1234' }, headers: originHeader() });
    expect(wrong.status()).toBe(401);
    expect((await wrong.json()).code).toBe('invalid_passcode');

    await page.goto('/admin');
    await page.getByLabel('Passcode').fill(ADMIN_PASSCODE);
    await page.getByRole('button', { name: 'Unlock' }).click();
    await expect(page.getByRole('heading', { name: 'Statuses' })).toBeVisible();
    const html = await page.content();
    expect(html).not.toContain('pin_hash');
    expect(html).not.toContain('fedcba9876543210');
    const staffTable = page.getByTestId('staff-table');
    await expect(staffTable).toContainText('Ahmed');
    await expect(staffTable).toContainText('Igor');
    await expect(staffTable.locator('tbody tr').first()).toContainText('yes');

    // add a status, save, and check the shop metafield
    await page.getByLabel('New status name').fill('Stone Setting Ahmed');
    await page.getByRole('button', { name: 'Add status' }).click();
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByRole('status')).toContainText('Saved');
    let state = await mockState(request);
    const settings = JSON.parse(state.shop.metafields['trax_production.settings']!.value) as { statuses: { id: string; name: string }[] };
    expect(settings.statuses.at(-1)).toEqual({ id: 'stone_setting_ahmed', name: 'Stone Setting Ahmed' });
    expect(state.shop.metafields['trax_production.staff']!.value).toContain('pin_hash'); // the store keeps hashes…

    // add a person through the form
    await page.getByLabel('Name', { exact: true }).fill('Maria');
    await page.getByLabel('PIN', { exact: true }).fill('5555');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByRole('status').last()).toContainText('Added Maria');
    await expect(staffTable).toContainText('Maria');
    state = await mockState(request);
    const staff = JSON.parse(state.shop.metafields['trax_production.staff']!.value) as { staff: { id: string; name: string; pin_hash: string; active: boolean }[] };
    const maria = staff.staff.find((s) => s.id === 'maria')!;
    expect(maria).toMatchObject({ name: 'Maria', active: true });
    expect(maria.pin_hash).toMatch(/^[0-9a-f]{64}$/);

    // …but no admin JSON response ever returns them
    const staffJson = await page.request.post('/api/admin/staff', { data: { action: 'clear_lock', id: 'maria' }, headers: originHeader() });
    expect(staffJson.status()).toBe(200);
    expect(await staffJson.text()).not.toContain('pin_hash');
    const settingsJson = await page.request.put('/api/admin/settings', {
      data: { statuses: settings.statuses.map((s) => ({ ...s })), stale_after_days: 3, work_days: [1, 2, 3, 4, 5], hide_items_matching: ['warranty'], watch_query: 'tag:custom-item-order status:open' },
      headers: originHeader(),
    });
    expect(settingsJson.status(), await settingsJson.text()).toBe(200);
    expect(await settingsJson.text()).not.toContain('pin_hash');

    // a status can be renamed but not deleted
    const del = await page.request.put('/api/admin/settings', {
      data: { statuses: settings.statuses.slice(1), stale_after_days: 3, work_days: [1, 2, 3, 4, 5], hide_items_matching: [], watch_query: '' },
      headers: originHeader(),
    });
    expect(del.status()).toBe(400);
    expect((await del.json()).error).toContain('cannot be deleted');
  });

  test('admin endpoints require the admin cookie', async ({ request }) => {
    const res = await request.put('/api/admin/settings', { data: {}, headers: originHeader() });
    expect(res.status()).toBe(401);
    const staff = await request.post('/api/admin/staff', { data: { action: 'add', name: 'X', pin: '1234' }, headers: originHeader() });
    expect(staff.status()).toBe(401);
  });
});
