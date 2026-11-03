import { describe, expect, it } from 'vitest';
import { DAILY_THRESHOLDS, dailyCheck, formatDailyReportSlack } from '@/lib/inventory/daily';
import { defaultInventorySettings, type InventorySettings, type MetalSlip, type ScrapSlip, type Slip } from '@/lib/inventory/model';
import { loadExport } from './inventory-model.test';

const slips = loadExport().slips.filter((s): s is Slip => s !== null);
const settings: InventorySettings = { ...defaultInventorySettings(), last_sync: { dust: { at: '2026-10-23T15:00:00Z', ok: true, count: 61 }, diamond: { at: '2026-10-23T15:00:00Z', ok: true, count: 3 }, scrap: { at: '2026-10-22T15:00:00Z', ok: false, count: 0, error: 'board not shared' } } };
const ids = (r: ReturnType<typeof dailyCheck>) => r.findings.map((f) => f.id);

function metal(id: string, who: string, date: string, extra: Partial<MetalSlip> = {}): MetalSlip {
  return { id, kind: 'metal', who, date, note: '', source: 'scan', createdAt: `${date}T20:00:00Z`, dust: null, lines: [], ...extra };
}

describe('daily check', () => {
  it('on the export, 2026-10-23 (a Friday): Chaerin owes a slip, the scrap sync failed, the casting sync never ran', () => {
    const r = dailyCheck(slips, settings, '2026-10-23', { syncEnabled: true, now: '2026-10-23T22:30:00Z' });
    expect(r.work_day).toBe(true);
    expect(r.today).toEqual({ dust_g: expect.closeTo(13.56, 2), slips: 2, scrap_in_g: 0, scrap_out_g: 0 });
    expect(r.findings.find((f) => f.id === 'metal.missing_slip')).toMatchObject({ severity: 'alert', title: 'No slip today from Chaerin' });
    expect(r.findings.find((f) => f.id === 'sync.failed')).toMatchObject({ severity: 'alert', title: 'Scrap (Jalgas): last sync failed' });
    expect(r.findings.find((f) => f.id === 'sync.never')).toMatchObject({ severity: 'warn', title: 'Castings (Rina): never synced' });
    expect(r.findings.find((f) => f.id === 'metal.refinery_lot')).toBeUndefined(); // Eric's last lot was Oct 14, more than a week before
    expect(r.counts.alert).toBe(2);
    expect(r.ok).toBe(false);
    // ordered alerts → warnings → notes
    const sev = r.findings.map((f) => f.severity);
    expect(sev).toEqual([...sev].sort((a, b) => ({ alert: 0, warn: 1, info: 2 })[a] - ({ alert: 0, warn: 1, info: 2 })[b]));
  });

  it('a Saturday is not a work day: no missing-slip alert; sync rules only when the sync is on', () => {
    const r = dailyCheck(slips, settings, '2026-10-24');
    expect(r.work_day).toBe(false);
    expect(ids(r)).not.toContain('metal.missing_slip');
    expect(ids(r)).not.toContain('sync.failed');
    expect(r.ok).toBe(true);
  });

  it('weeks later: stale diamond and casting counts, silent jewelers, a stale sync', () => {
    const r = dailyCheck(slips, settings, '2026-12-01', { syncEnabled: true, now: '2026-12-01T22:30:00Z' });
    expect(r.findings.find((f) => f.id === 'diamond.stale_count')).toMatchObject({ severity: 'alert', title: 'Diamond count is 33 days old' });
    expect(r.findings.find((f) => f.id === 'casting.stale_count')).toMatchObject({ severity: 'warn', title: 'Casting count is 41 days old' });
    expect(r.findings.find((f) => f.id === 'metal.silent_jeweler')).toMatchObject({ severity: 'alert', title: 'Chaerin, Mr. Sim, Mr. Kim: no slip for 3 work days' });
    expect(r.findings.filter((f) => f.id === 'sync.stale')).toHaveLength(2); // dust and diamond ok but old; scrap is "failed", casting "never"
  });

  it('a slip where the metal did not come back, a refinery lot, a dust outlier, the 7-day net', () => {
    const day = '2026-11-03'; // Tuesday
    const list: Slip[] = [
      metal('a', 'Chaerin', day, { dust: 0.2, lines: [{ item: '1', qty: 1, before: 10, after: 8 }] }), // loss 2, dust 0.2 → net 1.8 > 1.5
      metal('b', 'Mr. Sim', day, { dust: 150 }),
      metal('c', 'Mr. Kim', day, { dust: 3, lines: [{ item: '2', qty: 1, before: 20, after: 17.5 }] }), // net −0.5
      metal('d', 'Eric', '2026-11-01', { dust: 954.6, note: 'refinery lot' }),
      metal('e', 'Mr. Kim', '2026-10-30', { dust: 1, lines: [{ item: '3', qty: 1, before: 30, after: 27 }] }), // net 2 → week net 1.5 > 1.0
    ];
    const r = dailyCheck(list, defaultInventorySettings(), day);
    expect(r.findings.find((f) => f.id === 'metal.slip_net')).toMatchObject({ severity: 'alert', title: 'Chaerin: 1.8 g did not come back today' });
    expect(r.findings.find((f) => f.id === 'metal.dust_outlier')).toMatchObject({ severity: 'warn', title: 'Mr. Sim: 150 g of dust on one day' });
    expect(r.findings.find((f) => f.id === 'metal.refinery_lot')).toMatchObject({ severity: 'info', title: 'Refinery lot this week: 954.6 g' });
    expect(r.findings.filter((f) => f.id === 'metal.week_net').map((f) => f.title)).toEqual(['Mr. Kim: 1.5 g net loss over 7 days (3.0%)', 'Chaerin: 1.8 g net loss over 7 days (18.0%)']); // most dust first, like the table
    expect(ids(r)).not.toContain('metal.missing_slip');
    expect(r.today).toEqual({ dust_g: 153.2, slips: 3, scrap_in_g: 0, scrap_out_g: 0 });
  });

  it('scrap: negative on hand, outgoing batches, big pieces, missing $ and karat', () => {
    const day = '2026-11-03';
    const scrap = (id: string, dir: 'in' | 'out', to: string, lines: ScrapSlip['lines']): ScrapSlip => ({ id, kind: 'scrap', who: 'Jalgas', date: day, note: '', source: 'monday', createdAt: 'x', dir, to, lines });
    const list: Slip[] = [
      scrap('in', 'in', '', [{ what: '253060-Chain', karat: '10KY', grams: 3.64, value: 185.39 }, { what: 'Bails', karat: '', grams: 57.89, value: null }]),
      scrap('out', 'out', 'Mr. Kim', [{ what: 'Scrap for Mr Kim', karat: '14KY', grams: 30.02, value: 2246.13 }]),
    ];
    const r = dailyCheck(list, defaultInventorySettings(), day);
    expect(ids(r)).toEqual(expect.arrayContaining(['scrap.negative_on_hand', 'scrap.outgoing', 'scrap.big_piece', 'scrap.missing_value', 'scrap.missing_karat']));
    expect(r.findings.find((f) => f.id === 'scrap.negative_on_hand')!.title).toBe('14KY: more scrap went out than came in (-30.02 g)');
    expect(r.findings.find((f) => f.id === 'scrap.outgoing')!.title).toBe('30.02 g of scrap given to Mr. Kim');
    expect(r.today).toMatchObject({ scrap_in_g: expect.closeTo(61.53, 2), scrap_out_g: 30.02 });
  });

  it('formats one Slack message with a header, the headline and one line per finding', () => {
    const r = dailyCheck(slips, settings, '2026-10-23', { syncEnabled: true, now: '2026-10-23T22:30:00Z' });
    const m = formatDailyReportSlack(r, { link: 'https://inventory.traxnyc.com/inventory' });
    expect(m.text).toContain('*Inventory check · 2026-10-23* — 2 alerts · 1 warning');
    expect(m.text).toContain(':red_circle: *No slip today from Chaerin*');
    expect(m.text).toContain('diamonds 386.45 ct (2026-10-29)');
    expect(m.text.length).toBeLessThan(4000);
    const blocks = m.blocks as { type: string }[];
    expect(blocks[0]).toEqual({ type: 'header', text: { type: 'plain_text', text: 'Inventory check · 2026-10-23' } });
    expect(blocks[blocks.length - 1]).toMatchObject({ type: 'context' });
    const empty = dailyCheck([], defaultInventorySettings(), '2026-10-24');
    expect(ids(empty)).toEqual(['diamond.no_count', 'casting.no_count']);
    const quiet = formatDailyReportSlack({ ...empty, findings: [], counts: { alert: 0, warn: 0, info: 0 } });
    expect(quiet.text).toContain('Nothing to flag today');
    expect(quiet.text).toContain('not a work day');
    expect(DAILY_THRESHOLDS.slip_net_alert).toBe(1.5);
  });
});
