import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { karatKey, nameKey, normalizeName, numberCell, validateAccess, validateInventorySettings, validateJewelers, validateSlip, validateSlipInput, type MetalSlip, type ScrapSlip } from '@/lib/inventory/model';

export const EXPORT_FILE = path.join(process.cwd(), 'data', 'trax-inventory-2026-11-03.json');

export function loadExport() {
  const raw = JSON.parse(readFileSync(EXPORT_FILE, 'utf8')) as { count: number; docs: Record<string, unknown> };
  const slips = Object.entries(raw.docs).map(([id, doc]) => validateSlip({ ...(doc as object), id }));
  return { raw, slips };
}

describe('inventory model', () => {
  it('every one of the 93 exported records validates unchanged', () => {
    const { raw, slips } = loadExport();
    expect(raw.count).toBe(93);
    expect(slips.filter((s) => s === null)).toHaveLength(0);
    const chaerin = slips.find((s) => s?.id === 'metal-chaerin-2026-10-16') as MetalSlip;
    expect(chaerin.dust).toBe(8.2);
    expect(chaerin.lines).toHaveLength(5);
    expect(chaerin.lines[0]).toEqual({ item: '71900 (Rina)', qty: 2, before: 8.7, after: 7.8 });
    const out = slips.find((s) => s?.id === 'scrap-out-2026-10-14-mr-kim') as ScrapSlip;
    expect(out.dir).toBe('out');
    expect(out.to).toBe('Mr. Kim');
  });

  it('numbers: strings with a comma decimal, $ and blanks', () => {
    expect(numberCell('7,8')).toBe(7.8);
    expect(numberCell(' 12.5 ')).toBe(12.5);
    expect(numberCell('$280')).toBe(280);
    expect(numberCell('')).toBeNull();
    expect(numberCell(null)).toBeNull();
    expect(numberCell('abc')).toBeUndefined();
    expect(numberCell(Number.NaN)).toBeUndefined();
    expect(numberCell(1e12)).toBeUndefined();
  });

  it('karat and name normalisation', () => {
    expect(karatKey(' 14 k y ')).toBe('14KY');
    expect(karatKey('10TT')).toBe('10KTT');
    expect(karatKey('')).toBe('Unlabeled');
    expect(normalizeName('Mr.Kim')).toBe('Mr. Kim');
    expect(normalizeName('mr   kim')).toBe('Mr. Kim');
    expect(normalizeName('MR. SIM')).toBe('Mr. SIM');
    expect(normalizeName('chaerin')).toBe('Chaerin');
    expect(nameKey('Mr. Kim')).toBe('mrkim');
    expect(nameKey('mr kim')).toBe(nameKey('Mr.Kim'));
  });

  it('validateSlipInput: drops empty lines, keeps a dust-only metal slip, refuses nonsense', () => {
    const ok = validateSlipInput({ kind: 'metal', who: ' Chaerin ', date: '2026-10-19', lines: [{ item: '', qty: '', before: '', after: '' }, { item: '71900', qty: '2', before: '8.7', after: '7,8' }], dust: '2.37', note: 'x' });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.value.who).toBe('Chaerin');
      expect(ok.value.lines).toEqual([{ item: '71900', qty: 2, before: 8.7, after: 7.8 }]);
      expect((ok.value as MetalSlip).dust).toBe(2.37);
      expect(ok.value.source).toBe('manual');
    }
    expect(validateSlipInput({ kind: 'metal', date: '2026-10-19', lines: [], dust: 5 }).ok).toBe(true);
    expect(validateSlipInput({ kind: 'metal', date: '2026-10-19', lines: [], dust: null }).ok).toBe(false);
    expect(validateSlipInput({ kind: 'diamond', date: '2026-10-19', lines: [{ quality: 'SI', size: 'big' }] }).ok).toBe(false);
    expect(validateSlipInput({ kind: 'diamond', date: '2026-13-01', lines: [{ quality: 'SI', carats: 1 }] }).ok).toBe(false);
    expect(validateSlipInput({ kind: 'diamond', date: '2026-02-30', lines: [{ quality: 'SI', carats: 1 }] }).ok).toBe(false);
    expect(validateSlipInput({ kind: 'rings', date: '2026-10-19', lines: [] }).ok).toBe(false);
    expect(validateSlipInput({ kind: 'scrap', date: '2026-10-19', lines: [{ what: 'chain', grams: 1 }], dir: 'sideways', to: 'x' })).toMatchObject({ ok: true, value: { dir: 'in', to: '' } });
    expect(validateSlipInput({ kind: 'scrap', date: '2026-10-19', lines: [{ what: 'chain', grams: 1 }], dir: 'out', to: ' Mr. Kim ' })).toMatchObject({ ok: true, value: { dir: 'out', to: 'Mr. Kim' } });
    expect(validateSlipInput({ kind: 'casting', date: '2026-10-19', note: 'a\u0000b\tc', lines: [{ type: 'Ring', item: '1', yellow: 1 }] })).toMatchObject({ ok: true, value: { note: 'ab c' } });
  });

  it('validateSlip needs an id and a createdAt', () => {
    expect(validateSlip({ kind: 'metal', date: '2026-10-19', dust: 1, lines: [] })).toBeNull();
    expect(validateSlip({ id: 'Bad Id', kind: 'metal', date: '2026-10-19', dust: 1, lines: [], createdAt: '2026-10-19T00:00:00Z' })).toBeNull();
    expect(validateSlip({ id: 'ok-1', kind: 'metal', date: '2026-10-19', dust: 1, lines: [], createdAt: 'yesterday' })).toBeNull();
    expect(validateSlip({ id: 'ok-1', kind: 'metal', date: '2026-10-19', dust: 1, lines: [], createdAt: '2026-10-19T00:00:00Z', createdBy: 'Ahmed' })).toMatchObject({ id: 'ok-1', createdBy: 'Ahmed' });
  });

  it('settings: jewelers dedupe on the loose name key, access only knows the four sections', () => {
    expect(validateJewelers(['Chaerin', ' mr kim', 'Mr. Kim', ''])).toEqual(['Chaerin', 'mr kim']);
    expect(validateJewelers('Chaerin')).toBeNull();
    expect(validateAccess({ jin: { sections: ['diamond', 'diamond'] } })).toEqual({ jin: { sections: ['diamond'], write: true } });
    expect(validateAccess({ jin: { sections: ['rings'] } })).toBeNull();
    expect(validateAccess({ 'Bad Id': { sections: [] } })).toBeNull();
    const s = validateInventorySettings({ v: 1, jewelers: ['A'], access: {}, last_sync: { dust: { at: '2026-10-23T16:00:00Z', ok: true, count: 3 } } });
    expect(s).toMatchObject({ scrap_since: '2026-09-23', last_sync: { dust: { count: 3 } } });
    expect(validateInventorySettings({ v: 2 })).toBeNull();
  });
});
