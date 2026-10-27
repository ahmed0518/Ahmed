import { describe, expect, it } from 'vitest';
import { parseItemStatus, serializeItemStatus, validateItemStatus } from '@/lib/status/schema';

const good = {
  v: 1,
  visible_ids: ['50788056399960'],
  items: {
    '50788056399960': {
      title: 'Bracelet',
      status: 'cad',
      updated_at: '2026-10-27T15:12:03Z',
      updated_by: 'Ahmed',
      source: 'web',
      via: 'web:Ahmed',
      history: [{ kind: 'set', status: 'cad', at: '2026-10-27T15:12:03Z', by: 'Ahmed', source: 'web', via: 'web:Ahmed', note: '' }],
    },
  },
};

describe('item_status schema', () => {
  it('accepts the documented shape and keeps items prototype-free', () => {
    const r = parseItemStatus(JSON.stringify(good));
    expect(r.ok).toBe(true);
    if (!r.ok || !r.value) throw new Error('expected a value');
    expect(Object.getPrototypeOf(r.value.items)).toBeNull();
    expect(r.value.visible_ids).toEqual(['50788056399960']);
    expect(r.value.items['50788056399960']?.status).toBe('cad');
  });

  it('missing metafield is ok/null, malformed is not ok', () => {
    expect(parseItemStatus(null)).toEqual({ ok: true, value: null });
    expect(parseItemStatus('').ok).toBe(true);
    expect(parseItemStatus('{not json').ok).toBe(false);
    expect(parseItemStatus('[]').ok).toBe(false);
    expect(validateItemStatus({ ...good, v: 2 }).ok).toBe(false);
    expect(validateItemStatus({ v: 1 }).ok).toBe(false);
  });

  it('rejects bad keys, bad timestamps and bad status ids', () => {
    expect(validateItemStatus({ v: 1, items: { abc: good.items['50788056399960'] } }).ok).toBe(false);
    expect(validateItemStatus({ v: 1, items: { __proto__: good.items['50788056399960'] } }).ok).toBe(true); // JSON.parse would drop it; literal __proto__ here is inherited, not own
    expect(validateItemStatus({ v: 1, items: JSON.parse('{"__proto__": {}}') }).ok).toBe(false);
    const ms = structuredClone(good);
    ms.items['50788056399960']!.updated_at = '2026-10-27T15:12:03.000Z';
    expect(validateItemStatus(ms).ok).toBe(false);
    const upper = structuredClone(good);
    upper.items['50788056399960']!.status = 'CAD';
    expect(validateItemStatus(upper).ok).toBe(false);
    const badKind = structuredClone(good);
    badKind.items['50788056399960']!.history[0]!.kind = 'delete';
    expect(validateItemStatus(badKind).ok).toBe(false);
    expect(validateItemStatus({ ...good, visible_ids: ['x'] }).ok).toBe(false);
  });

  it('fills defaults for a partial direct write and drops unknown fields', () => {
    const partial = {
      v: 1,
      items: { '1': { title: 'T', status: null, updated_at: '2026-10-27T15:12:03Z', updated_by: 'Claude', extra: 'dropped' } },
    };
    const r = validateItemStatus(partial);
    expect(r.ok).toBe(true);
    if (!r.ok || !r.value) throw new Error('expected a value');
    expect(r.value.visible_ids).toBeUndefined();
    expect(r.value.items['1']).toEqual({ title: 'T', status: null, updated_at: '2026-10-27T15:12:03Z', updated_by: 'Claude', source: 'import', via: 'Claude', history: [] });
    expect(JSON.stringify(r.value)).not.toContain('extra');
  });

  it('serializes minified with visible_ids', () => {
    const r = parseItemStatus(JSON.stringify(good));
    if (!r.ok || !r.value) throw new Error('expected a value');
    const s = serializeItemStatus(r.value);
    expect(s).not.toContain('\n');
    expect(JSON.parse(s)).toEqual(good);
  });
});
