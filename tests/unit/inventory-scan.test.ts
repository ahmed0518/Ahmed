import { describe, expect, it } from 'vitest';
import { draftFromReply, parseJsonReply, scanPrompt } from '@/lib/inventory/scan';

describe('photo reading', () => {
  it('prompts: one per section, the current year filled in, JSON only', () => {
    expect(scanPrompt('metal', 2026)).toContain('use 2026');
    for (const k of ['metal', 'diamond', 'scrap', 'casting'] as const) expect(scanPrompt(k)).toMatch(/ONLY one JSON object/);
    expect(scanPrompt('diamond')).toContain('Total Diamond Holding');
  });

  it('parses the reply with or without a code fence and refuses prose', () => {
    expect(parseJsonReply('```json\n{"who":"Chaerin","lines":[]}\n```')).toEqual({ who: 'Chaerin', lines: [] });
    expect(parseJsonReply('Here you go: {"a":1} thanks')).toEqual({ a: 1 });
    expect(() => parseJsonReply('I cannot read this')).toThrow(/could not be read/);
    expect(() => parseJsonReply('{"a":')).toThrow(/could not be read/);
  });

  it('reduces the reply to strings for the form, per section', () => {
    const d = draftFromReply('metal', { who: 'Mr. Kim', date: '2026-10-19', dust: 3.99, note: 'ok', lines: [{ item: '71850 (Danny)', qty: 1, before: 11.1, after: 10.5, extra: 'x' }, 'junk'] });
    expect(d).toEqual({ kind: 'metal', who: 'Mr. Kim', date: '2026-10-19', dust: '3.99', note: 'ok', dir: 'in', to: '', lines: [{ item: '71850 (Danny)', qty: '1', before: '11.1', after: '10.5' }, { item: '', qty: '', before: '', after: '' }] });
    const s = draftFromReply('scrap', { dir: 'out', to: 'Mr. Kim', date: 'Oct 19', lines: [{ what: 'batch', karat: '14KY', grams: 30.02, value: 2246 }] });
    expect(s).toMatchObject({ dir: 'out', to: 'Mr. Kim', date: null, lines: [{ what: 'batch', karat: '14KY', grams: '30.02', value: '2246' }] });
    expect(draftFromReply('diamond', 'nonsense')).toMatchObject({ kind: 'diamond', lines: [], who: '', date: null });
  });
});
