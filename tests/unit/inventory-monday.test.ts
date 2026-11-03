import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { resetEnvCache } from '@/lib/env';
import { CASTING_COLS, CASTING_ID, DIAMOND_COLS, DUST_COLS, DUST_GROUP, SCRAP_COLS, mapCastingRows, mapDiamondRows, mapDustRows, mapScrapRows, syncMonday, type MapContext, type MondayItem } from '@/lib/inventory/monday';
import type { CastingSlip, DiamondSlip, MetalSlip, ScrapSlip, Slip } from '@/lib/inventory/model';
import { FileInventoryStore } from '@/lib/inventory/store-file';

function item(name: string, group: string, cols: Record<string, string>, id = name): MondayItem {
  return { id, name, group: { id: group.toLowerCase(), title: group }, column_values: Object.entries(cols).map(([cid, text]) => ({ id: cid, text })) };
}

const ctx: MapContext = { existing: [], today: '2026-11-03', now: '2026-11-03T16:00:00Z', scrapSince: '2026-09-23' };

describe('monday.com mappers', () => {
  it('dust: one slip per person-day from the current group, refinery lots labelled, scanned duplicates skipped', () => {
    const items = [
      item('row1', DUST_GROUP, { [DUST_COLS.person]: 'Mr.Kim', [DUST_COLS.grams]: '5.57', [DUST_COLS.date]: '2026-10-22' }),
      item('row2', DUST_GROUP, { [DUST_COLS.person]: 'Eric', [DUST_COLS.grams]: '954.6', [DUST_COLS.date]: '2026-10-14' }),
      item('row3', DUST_GROUP, { [DUST_COLS.person]: 'Chaerin', [DUST_COLS.grams]: '2.37', [DUST_COLS.date]: '2026-10-20' }),
      item('row4', DUST_GROUP, { [DUST_COLS.person]: 'Chaerin', [DUST_COLS.grams]: '1.00', [DUST_COLS.date]: '2026-10-20' }),
      item('row5', 'Old 2024', { [DUST_COLS.person]: 'Chaerin', [DUST_COLS.grams]: '9', [DUST_COLS.date]: '2024-01-01' }),
      item('row6', DUST_GROUP, { [DUST_COLS.person]: 'Jorge', [DUST_COLS.grams]: '', [DUST_COLS.date]: '2026-10-20' }),
    ];
    const scanned: MetalSlip = { id: 'metal-chaerin-2026-10-19', kind: 'metal', who: 'Chaerin', date: '2026-10-19', note: '', source: 'scan', createdAt: 'x', dust: 2.37, lines: [{ item: 'a', qty: 1, before: 1, after: 0.9 }] };
    const res = mapDustRows(items, { ...ctx, existing: [scanned] });
    expect(res.skipped).toBe(2); // the duplicate of the scanned slip and the empty row (the old group is simply ignored)
    expect(res.dropped).toBe(0);
    expect(res.slips.map((s) => s.id)).toEqual(['dust-mr-kim-2026-10-22', 'dust-eric-2026-10-14', 'dust-chaerin-2026-10-20']);
    expect(res.slips[0]).toMatchObject({ who: 'Mr. Kim', dust: 5.57, source: 'monday', lines: [] });
    expect((res.slips[1] as MetalSlip).note).toMatch(/refinery/);
    expect((res.slips[2] as MetalSlip).dust).toBe(1); // 2.37 was already on the scanned slip; the other row stays
  });

  it('diamonds: one slip per grade, dated by the latest "last counted"', () => {
    const items = [
      item('0.7', 'SI', { [DIAMOND_COLS.size]: '0.7', [DIAMOND_COLS.carats]: '7.39', [DIAMOND_COLS.price]: '280', [DIAMOND_COLS.counted]: '2026-10-29' }),
      item('0.8', 'SI', { [DIAMOND_COLS.size]: '0.8', [DIAMOND_COLS.carats]: '6.01', [DIAMOND_COLS.price]: '$280', [DIAMOND_COLS.counted]: '2026-10-27', [DIAMOND_COLS.note]: 'low' }),
      item('1.3', 'VS-SI', { [DIAMOND_COLS.size]: '1.3', [DIAMOND_COLS.carats]: '11.79', [DIAMOND_COLS.price]: '220', [DIAMOND_COLS.counted]: '' }),
      item('2.0', 'VS-SI', { [DIAMOND_COLS.size]: '2', [DIAMOND_COLS.carats]: '' }),
    ];
    const res = mapDiamondRows(items, ctx);
    expect(res.skipped).toBe(1);
    expect(res.slips.map((s) => s.id)).toEqual(['diamond-si-monday', 'diamond-vs-si-monday']);
    const si = res.slips[0] as DiamondSlip;
    expect(si).toMatchObject({ who: 'Mr. Jin', date: '2026-10-29', source: 'monday' });
    expect(si.lines).toEqual([
      { quality: 'SI', size: 0.7, carats: 7.39, price: 280 },
      { quality: 'SI', size: 0.8, carats: 6.01, price: 280 },
    ]);
    expect(si.note).toContain('0.8 mm: low');
    expect((res.slips[1] as DiamondSlip).date).toBe('2026-11-03'); // no count date on the board → today
  });

  it('castings: the board is one count whose date only moves when a line changes', () => {
    const items = [
      item('66101', 'Castings', { [CASTING_COLS.type]: 'Frame', [CASTING_COLS.yellow]: '4', [CASTING_COLS.weight]: '8.35', [CASTING_COLS.karat]: '14K', [CASTING_COLS.price]: '89' }),
      item('68837', 'Castings', { [CASTING_COLS.type]: 'Ring', [CASTING_COLS.white]: '2', [CASTING_COLS.yellow]: '2', [CASTING_COLS.weight]: '2.84', [CASTING_COLS.karat]: '18K', [CASTING_COLS.price]: '115' }),
      item('empty', 'Castings', { [CASTING_COLS.type]: 'Ring' }),
    ];
    const first = mapCastingRows(items, ctx);
    expect(first.skipped).toBe(1);
    const slip = first.slips[0] as CastingSlip;
    expect(slip).toMatchObject({ id: CASTING_ID, who: 'Rina', date: '2026-11-03' });
    expect(slip.lines[0]).toEqual({ type: 'Frame', item: '66101', karat: '14K', yellow: 4, white: null, rose: null, weight: 8.35, price: 89 });
    const again = mapCastingRows(items, { ...ctx, existing: [slip], today: '2026-11-04', now: '2026-11-04T16:00:00Z' });
    expect(again.slips[0]).toMatchObject({ date: '2026-11-03', createdAt: '2026-11-03T16:00:00Z' });
    const changed = mapCastingRows([items[0]!], { ...ctx, existing: [slip], today: '2026-11-04' });
    expect(changed.slips[0]!.date).toBe('2026-11-04');
  });

  it('scrap: Scrapping = in per day, Outgoing = out per day and receiver, cutover and bad $ handled', () => {
    const items = [
      item('Chain', 'Scrapping', { [SCRAP_COLS.date]: '2026-09-23', [SCRAP_COLS.karat]: '10ky', [SCRAP_COLS.grams]: '1.45', [SCRAP_COLS.value]: '80.4', [SCRAP_COLS.order]: '249752' }),
      item('Lock', 'Scrapping', { [SCRAP_COLS.date]: '2026-09-23', [SCRAP_COLS.karat]: '14 KY', [SCRAP_COLS.grams]: '1.15', [SCRAP_COLS.value]: '80' }),
      item('10K chain', 'Scrapping', { [SCRAP_COLS.date]: '2026-10-06', [SCRAP_COLS.karat]: '10KY', [SCRAP_COLS.grams]: '2', [SCRAP_COLS.value]: '1240121' }),
      item('Scrap for Mr Kim', 'Outgoing Scrap', { [SCRAP_COLS.date]: '2026-10-14', [SCRAP_COLS.karat]: '14KY', [SCRAP_COLS.grams]: '30.02', [SCRAP_COLS.value]: '2246.13', [SCRAP_COLS.person]: 'Mr.Kim' }),
      item('251434', 'Outgoing Scrap', { [SCRAP_COLS.date]: '2026-10-19', [SCRAP_COLS.karat]: '14KY', [SCRAP_COLS.grams]: '2.65', [SCRAP_COLS.value]: '201.42', [SCRAP_COLS.order]: '251434' }),
      item('18K batch', 'Outgoing Scrap', { [SCRAP_COLS.date]: '2026-09-22', [SCRAP_COLS.karat]: '18KY', [SCRAP_COLS.grams]: '31.65' }),
      item('Held', 'On Hold', { [SCRAP_COLS.date]: '2026-10-01', [SCRAP_COLS.grams]: '5' }),
    ];
    const res = mapScrapRows(items, ctx);
    expect(res.skipped).toBe(2);
    expect(res.slips.map((s) => s.id)).toEqual(['scrap-in-2026-09-23', 'scrap-in-2026-10-06', 'scrap-out-2026-10-14-mr-kim', 'scrap-out-2026-10-19-order-251434']);
    const day = res.slips[0] as ScrapSlip;
    expect(day).toMatchObject({ dir: 'in', who: 'Jalgas', to: '' });
    expect(day.lines).toEqual([
      { what: '249752-Chain', karat: '10KY', grams: 1.45, value: 80.4 },
      { what: 'Lock', karat: '14KY', grams: 1.15, value: 80 },
    ]);
    const bad = res.slips[1] as ScrapSlip;
    expect(bad.lines[0]!.value).toBeNull();
    expect(bad.note).toMatch(/order number/);
    expect(res.slips[2]).toMatchObject({ dir: 'out', to: 'Mr. Kim' });
    expect(res.slips[3]).toMatchObject({ dir: 'out', to: 'Order 251434' });
  });
});

describe('syncMonday', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'trax-sync-'));
  const ENV = {
    SHOPIFY_STORE_DOMAIN: '05nbj6-yr.myshopify.com',
    SHOPIFY_CLIENT_ID: 'id',
    SHOPIFY_CLIENT_SECRET: 'secret',
    SESSION_SECRET: 'a'.repeat(64),
    PIN_PEPPER: 'b'.repeat(64),
    INVENTORY_DATA_DIR: dir,
    MONDAY_API_TOKEN: 'monday-test-token',
    MONDAY_API_URL: 'https://monday.test/v2',
  };
  beforeAll(() => {
    for (const [k, v] of Object.entries(ENV)) process.env[k] = v;
    resetEnvCache();
  });
  afterAll(() => {
    for (const k of Object.keys(ENV)) delete process.env[k];
    resetEnvCache();
    rmSync(dir, { recursive: true, force: true });
  });
  afterEach(() => undefined);

  it('walks the pages, writes the slips, stamps last_sync, and records a failed board without throwing', async () => {
    const store = new FileInventoryStore(dir);
    const calls: { query: string; variables: Record<string, unknown>; auth: string | null }[] = [];
    const dustRows = Array.from({ length: 3 }, (_, i) => item(`r${i}`, DUST_GROUP, { [DUST_COLS.person]: 'Mr. Sim', [DUST_COLS.grams]: String(i + 1), [DUST_COLS.date]: `2026-10-0${i + 1}` }));
    const fetchImpl: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, unknown> };
      calls.push({ ...body, auth: (init?.headers as Record<string, string>).Authorization ?? null });
      if (body.variables.board === '9504626073') return Response.json({ data: { boards: [{ items_page: { cursor: 'c1', items: dustRows.slice(0, 2) } }] } });
      if (body.variables.cursor === 'c1') return Response.json({ data: { next_items_page: { cursor: null, items: dustRows.slice(2) } } });
      if (body.variables.board === '18437692268') return new Response('oops', { status: 500 });
      return Response.json({ errors: [{ message: 'board not shared' }] });
    };
    const results = await syncMonday(store, ['dust', 'diamond', 'scrap'], { fetchImpl, now: new Date('2026-11-03T16:00:00Z') });
    expect(results.map((r) => [r.board, r.ok, r.written])).toEqual([
      ['dust', true, 3],
      ['diamond', false, 0],
      ['scrap', false, 0],
    ]);
    expect(results[1]!.error).toMatch(/gave up: HTTP 500/);
    expect(results[2]!.error).toMatch(/board not shared/);
    expect(calls[0]!.auth).toBe('monday-test-token');
    expect(calls.filter((c) => c.variables.board === '18437692268')).toHaveLength(3); // retried
    const slips = (await store.listSlips()) as Slip[];
    expect(slips.map((s) => s.id).sort()).toEqual(['dust-mr-sim-2026-10-01', 'dust-mr-sim-2026-10-02', 'dust-mr-sim-2026-10-03']);
    const settings = await store.getSettings();
    expect(settings.last_sync.dust).toEqual({ at: '2026-11-03T16:00:00Z', ok: true, count: 3 });
    expect(settings.last_sync.diamond).toMatchObject({ ok: false, count: 0, error: expect.stringMatching(/500/) });
    // a second run upserts the same ids: still three
    await syncMonday(store, ['dust'], { fetchImpl, now: new Date('2026-11-04T16:00:00Z') });
    expect(await store.listSlips()).toHaveLength(3);
    await store.close();
  });
});
