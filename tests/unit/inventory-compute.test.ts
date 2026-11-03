import { describe, expect, it } from 'vitest';
import { byKind, latestCasting, latestCount, metalRows, missingToday, scrapSince, scrapSummary, slipAmount, sortSlips, tiles } from '@/lib/inventory/compute';
import type { Slip } from '@/lib/inventory/model';
import { loadExport } from './inventory-model.test';

const slips = loadExport().slips.filter((s): s is Slip => s !== null);
const TODAY = '2026-10-23';

describe('inventory maths on the exported records', () => {
  it('gold dust: per person this month, loss = before − after, net only on paired days', () => {
    const october = byKind(slips, 'metal').filter((s) => s.date.startsWith('2026-10'));
    const rows = metalRows(october);
    expect(rows.map((r) => r.who)).toEqual(['Eric', 'Danny', 'Chaerin', 'Mr. Kim', 'Mr. Sim', 'Jorge', 'Avezedo']);
    const chaerin = rows[2]!;
    expect(chaerin.dust).toBeCloseTo(82.95, 2);
    expect(chaerin.before).toBeCloseTo(95.8, 2);
    expect(chaerin.after).toBeCloseTo(86.3, 2);
    expect(chaerin.slips).toBe(2);
    expect(chaerin.days).toBe(14);
    expect(chaerin.paired).toBe(2);
    expect(chaerin.pairedLoss - chaerin.pairedDust).toBeCloseTo(-1.07, 2);
    const eric = rows[0]!;
    expect(eric.dust).toBeCloseTo(954.6, 2);
    expect(eric.slips).toBe(0);
    expect(rows.reduce((t, r) => t + r.dust, 0)).toBeCloseTo(1516.46, 2);
  });

  it('gold dust: spellings of one name are one row', () => {
    const base = { kind: 'metal' as const, note: '', source: 'manual' as const, createdAt: 'x', lines: [] };
    const rows = metalRows([
      { ...base, id: 'a', who: 'Mr. Kim', date: '2026-10-30', dust: 1 },
      { ...base, id: 'b', who: 'Mr Kim', date: '2026-10-31', dust: 2 },
      { ...base, id: 'c', who: 'MR.KIM', date: '2026-11-01', dust: 3 },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ who: 'Mr. Kim', dust: 6, days: 3 });
  });

  it('diamonds: the latest count per grade, merged by size', () => {
    const c = latestCount(byKind(slips, 'diamond'))!;
    expect(c.date).toBe('2026-10-29');
    expect(c.groups.map((g) => g.quality)).toEqual(['SI', 'VS-SI', 'VS2-SI1']);
    expect(c.n).toBe(74);
    expect(c.ct).toBeCloseTo(386.45, 2);
    expect(c.value).toBeCloseTo(125994.9, 1);
    expect(c.unpriced).toBe(0);
    const si = c.groups[0]!;
    expect(si.rows[0]).toEqual({ size: 0.7, carats: 7.39, price: 280, value: 7.39 * 280 });
    // two sheets of one grade on the same day merge; an older sheet of another grade keeps its own date
    const merged = latestCount([
      { id: 'a', kind: 'diamond', who: 'Jin', date: '2026-10-29', note: '', source: 'manual', createdAt: 'x', lines: [{ quality: 'SI', size: 1, carats: 1, price: 100 }] },
      { id: 'b', kind: 'diamond', who: 'Jin', date: '2026-10-29', note: '', source: 'manual', createdAt: 'x', lines: [{ quality: 'SI', size: 1, carats: 2, price: null }] },
      { id: 'c', kind: 'diamond', who: 'Jin', date: '2026-10-01', note: '', source: 'manual', createdAt: 'x', lines: [{ quality: 'VS', size: 2, carats: 5, price: null }] },
    ])!;
    expect(merged.groups[0]).toMatchObject({ quality: 'SI', ct: 3, value: 300, rows: [{ size: 1, carats: 3, price: 100, value: 300 }] });
    expect(merged.groups[1]).toMatchObject({ quality: 'VS', date: '2026-10-01', unpriced: 1, value: 0 });
    expect(merged.date).toBe('2026-10-29');
    expect(latestCount([])).toBeNull();
  });

  it('castings: pieces = Y + W + R, value = pieces × g/pc × $/g, by type', () => {
    const c = latestCasting(byKind(slips, 'casting'))!;
    expect(c.date).toBe('2026-10-21');
    expect(c.who).toBe('Rina');
    expect(c.pcs).toBe(389);
    expect(c.items).toBe(36);
    expect(c.grams).toBeCloseTo(835.13, 2);
    expect(c.value).toBeCloseTo(76307.25, 2);
    expect(c.groups.map((g) => [g.type, g.pcs])).toEqual([
      ['Earring', 161],
      ['Cross', 92],
      ['Ring', 80],
      ['Necklace', 46],
      ['Frame', 10],
    ]);
    expect(c.yellow + c.white + c.rose).toBe(389);
  });

  it('scrap: on hand = in − out by karat, since the cutover only', () => {
    const all = scrapSummary(byKind(slips, 'scrap'));
    expect(all.onhand).toBeCloseTo(395.58, 2);
    const ledger = scrapSince(byKind(slips, 'scrap'), '2026-09-23');
    expect(ledger).toHaveLength(20);
    const s = scrapSummary(ledger);
    expect(s.ins).toBeCloseTo(459.42, 2);
    expect(s.outs).toBeCloseTo(77.1, 2);
    expect(s.onhand).toBeCloseTo(382.32, 2);
    expect(s.value).toBeCloseTo(28843.05, 2);
    expect(s.pieces).toBe(106);
    expect(s.to).toEqual([
      { to: 'Mr. Kim', grams: expect.closeTo(74.45, 2), value: expect.closeTo(5314.73, 2) },
      { to: 'Order 251434', grams: 2.65, value: 201.42 },
    ]);
    const y14 = s.rows.find((r) => r.karat === '14KY')!;
    expect(y14.out).toBeCloseTo(32.67, 2); // Mr. Kim's batch + the order
    expect(s.rows[0]!.karat).toBe('14KY'); // most on hand first
    expect(scrapSummary([{ id: 'x', kind: 'scrap', who: '', date: '2026-10-01', note: '', source: 'manual', createdAt: 'x', dir: 'in', to: '', lines: [{ what: 'a', karat: '10 tt', grams: 1, value: null }] }]).rows[0]!.karat).toBe('10KTT');
  });

  it('tiles: the four headline numbers', () => {
    const t = tiles(slips, TODAY, '2026-09-23');
    expect(t.metal).toEqual({ dust: expect.closeTo(1516.46, 2), people: 7, any: true });
    expect(t.diamond).toEqual({ ct: expect.closeTo(386.45, 2), value: expect.closeTo(125994.9, 1), date: '2026-10-29' });
    expect(t.casting).toEqual({ pcs: 389, value: expect.closeTo(76307.25, 2), date: '2026-10-21' });
    expect(t.scrap).toEqual({ onhand: expect.closeTo(382.32, 2), value: expect.closeTo(28843.05, 2), any: true });
    const empty = tiles([], TODAY, '2026-09-23');
    expect(empty).toEqual({ metal: { dust: 0, people: 0, any: false }, diamond: null, casting: null, scrap: { onhand: 0, value: 0, any: false } });
  });

  it('who still owes a slip today', () => {
    const m = byKind(slips, 'metal');
    expect(missingToday(m, ['Chaerin', 'Mr. Sim', 'Mr. Kim'], '2026-10-23')).toEqual({ in: ['Mr. Sim', 'Mr. Kim'], missing: ['Chaerin'] });
    expect(missingToday(m, ['mr kim'], '2026-10-23')).toEqual({ in: ['mr kim'], missing: [] });
    expect(missingToday(m, ['Chaerin'], '2026-11-03')).toEqual({ in: [], missing: ['Chaerin'] });
  });

  it('log lines and order', () => {
    const byId = new Map(slips.map((s) => [s.id, s]));
    expect(slipAmount(byId.get('metal-chaerin-2026-10-16')!)).toBe('65.6 → 58.6 g');
    expect(slipAmount(byId.get('dust-eric-2026-09-17')!)).toBe('1,163.3 g dust');
    expect(slipAmount(byId.get('diamond-si-monday')!)).toBe('189.95 ct · SI');
    expect(slipAmount(byId.get('casting-rina-2026-10-21')!)).toBe('389 pcs · 36 items');
    expect(slipAmount(byId.get('scrap-out-2026-10-14-mr-kim')!)).toBe('−74.45 g → Mr. Kim');
    expect(slipAmount(byId.get('scrap-in-2026-09-23')!)).toBe('+1.45 g');
    const sorted = sortSlips(slips);
    expect(sorted[0]!.date).toBe('2026-10-29');
    expect(sorted[sorted.length - 1]!.date).toBe('2025-09-17');
  });
});
