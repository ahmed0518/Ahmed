import { describe, expect, it } from 'vitest';
import { applyChanges, trimToSize } from '@/lib/status/merge';
import { serializeItemStatus } from '@/lib/status/schema';
import { HISTORY_CAP, type Actor } from '@/lib/status/types';
import { entry, itemStatus } from './helpers';

const ahmed: Actor = { by: 'Ahmed', source: 'web', via: 'web:Ahmed' };
const maks: Actor = { by: 'Maks', source: 'api', via: 'token:maks-ai' };
const now = new Date('2026-10-27T15:12:03.789Z');
const titles = new Map([['1', 'Bracelet']]);

describe('applyChanges', () => {
  it('set creates the entry with a history line and the actor', () => {
    const { next, kinds } = applyChanges(null, [{ lineItemId: '1', status: 'cad', note: '' }], ahmed, titles, now);
    expect(kinds['1']).toBe('set');
    const e = next.items['1']!;
    expect(e).toMatchObject({ title: 'Bracelet', status: 'cad', updated_at: '2026-10-27T15:12:03Z', updated_by: 'Ahmed', source: 'web', via: 'web:Ahmed' });
    expect(e.history).toEqual([{ kind: 'set', status: 'cad', at: '2026-10-27T15:12:03Z', by: 'Ahmed', source: 'web', via: 'web:Ahmed', note: '' }]);
    expect(Object.getPrototypeOf(next.items)).toBeNull();
  });

  it('writing the current status again is a confirmation', () => {
    const current = itemStatus({ '1': entry('cad', '2026-10-20T10:00:00Z') });
    const { next, kinds } = applyChanges(current, [{ lineItemId: '1', status: 'cad', note: 'still at the bench' }], maks, titles, now);
    expect(kinds['1']).toBe('confirm');
    const e = next.items['1']!;
    expect(e.status).toBe('cad');
    expect(e.updated_at).toBe('2026-10-27T15:12:03Z');
    expect(e.updated_by).toBe('Maks');
    expect(e.via).toBe('token:maks-ai');
    expect(e.history.at(-1)).toMatchObject({ kind: 'confirm', status: 'cad', by: 'Maks', source: 'api', note: 'still at the bench' });
    // the original is untouched
    expect(current.items['1']!.updated_by).toBe('Ahmed');
  });

  it('null clears but keeps the entry', () => {
    const current = itemStatus({ '1': entry('cad', '2026-10-20T10:00:00Z') });
    const { next, kinds } = applyChanges(current, [{ lineItemId: '1', status: null, note: '' }], ahmed, titles, now);
    expect(kinds['1']).toBe('clear');
    expect(next.items['1']).toMatchObject({ status: null, updated_by: 'Ahmed' });
    expect(next.items['1']!.history.at(-1)).toMatchObject({ kind: 'clear', status: null });
  });

  it('caps history at 30 entries, dropping the oldest, and trims notes to 200 chars', () => {
    let current = itemStatus({ '1': entry('cad', '2026-10-01T10:00:00Z') });
    for (let i = 0; i < 40; i++) {
      current = applyChanges(current, [{ lineItemId: '1', status: i % 2 ? 'cad' : 'mold', note: 'x'.repeat(300) }], ahmed, titles, new Date(now.getTime() + i * 1000)).next;
    }
    const h = current.items['1']!.history;
    expect(h).toHaveLength(HISTORY_CAP);
    expect(h[0]!.at).not.toBe('2026-10-01T10:00:00Z');
    expect(h.at(-1)!.note).toHaveLength(200);
  });

  it('strips control characters from notes', () => {
    const { next } = applyChanges(null, [{ lineItemId: '1', status: 'cad', note: 'a\u0000b\u0007c  d' }], ahmed, titles, now);
    expect(next.items['1']!.history[0]!.note).toBe('abc d');
  });
});

describe('trimToSize', () => {
  it('returns the same object when it fits', () => {
    const s = itemStatus({ '1': entry('cad', '2026-10-20T10:00:00Z') });
    expect(trimToSize(s, 100_000)).toBe(s);
  });

  it('drops the oldest history entries round-robin until it fits', () => {
    let s = itemStatus({ '1': entry('cad', '2026-10-01T10:00:00Z'), '2': entry('mold', '2026-10-01T10:00:00Z') });
    for (let i = 0; i < 25; i++) {
      s = applyChanges(
        s,
        [
          { lineItemId: '1', status: i % 2 ? 'cad' : 'mold', note: 'n'.repeat(150) },
          { lineItemId: '2', status: i % 2 ? 'cad' : 'mold', note: 'n'.repeat(150) },
        ],
        ahmed,
        titles,
        new Date(now.getTime() + i * 1000),
      ).next;
    }
    const before = serializeItemStatus(s).length;
    const limit = Math.floor(before / 2);
    const trimmed = trimToSize(s, limit)!;
    expect(trimmed).not.toBeNull();
    expect(serializeItemStatus(trimmed).length).toBeLessThanOrEqual(limit);
    const h1 = trimmed.items['1']!.history.length;
    const h2 = trimmed.items['2']!.history.length;
    expect(Math.abs(h1 - h2)).toBeLessThanOrEqual(1);
    // newest entries survive
    expect(trimmed.items['1']!.history.at(-1)!.at).toBe(s.items['1']!.history.at(-1)!.at);
  });

  it('returns null when even empty histories do not fit', () => {
    const s = itemStatus({ '1': entry('cad', '2026-10-20T10:00:00Z') });
    expect(trimToSize(s, 10)).toBeNull();
  });
});
