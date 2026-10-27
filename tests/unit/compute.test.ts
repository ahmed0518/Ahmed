import { describe, expect, it } from 'vitest';
import { buildSummary, compute, type ComputeInput } from '@/lib/status/compute';
import { TZ, entry, itemStatus, ny, settings } from './helpers';

const now = ny('2026-10-27T12:00:00'); // Tuesday
const base = (overrides: Partial<ComputeInput>): ComputeInput => ({
  itemStatus: null,
  visible: [{ id: '1', title: 'Bracelet' }],
  createdAt: ny('2026-10-14T01:46:01'),
  shipped: false,
  settings: settings(),
  now,
  tz: TZ,
  ...overrides,
});

describe('tracking, done and tag', () => {
  it('never set: stale from created_at, tag not wanted', () => {
    const c = compute(base({}));
    expect(c.tracking).toBe('never_set');
    expect(c.stale_since).toBe('2026-10-14T05:46:01Z');
    expect(c.stale).toBe(true);
    expect(c.stale_reason).toBe('never_set');
    expect(c.all_done).toBe(false);
    expect(c.open_items).toBe(1);
    expect(c.untracked_count).toBe(1);
    expect(c.summary).toBe('No status yet');
    expect(c.should_have_tag).toBe(false);
    expect(c.last_updated_at).toBeNull();
  });

  it('an untracked visible item keeps the order not done; a done status on every item removes the tag', () => {
    const oneDone = compute(
      base({
        visible: [
          { id: '1', title: 'A' },
          { id: '2', title: 'B' },
        ],
        itemStatus: itemStatus({ '1': entry('sent_to_store', '2026-10-27T14:00:00Z') }),
      }),
    );
    expect(oneDone.all_done).toBe(false);
    expect(oneDone.tracking).toBe('in_progress');
    expect(oneDone.should_have_tag).toBe(true);
    expect(oneDone.done_items).toBe(1);
    expect(oneDone.open_items).toBe(1);
    expect(oneDone.untracked_count).toBe(1);

    const allDone = compute(
      base({
        visible: [
          { id: '1', title: 'A' },
          { id: '2', title: 'B' },
        ],
        itemStatus: itemStatus({ '1': entry('sent_to_store', '2026-10-27T14:00:00Z'), '2': entry('sent_to_shipping_dept', '2026-10-01T14:00:00Z') }),
      }),
    );
    expect(allDone.all_done).toBe(true);
    expect(allDone.tracking).toBe('all_done');
    expect(allDone.should_have_tag).toBe(false);
    expect(allDone.stale).toBe(false);
    expect(allDone.stale_since).toBeNull();
    expect(allDone.stale_reason).toBeNull();
  });

  it('removed items are excluded: an entry whose id is not visible does not count', () => {
    const c = compute(
      base({
        visible: [{ id: '1', title: 'A' }],
        itemStatus: itemStatus({ '1': entry('sent_to_store', '2026-10-27T14:00:00Z'), '9': entry('cad', '2026-09-01T14:00:00Z') }),
      }),
    );
    expect(c.all_done).toBe(true);
    expect(c.stale).toBe(false);
    expect(c.item_count).toBe(1);
    // but the latest change still comes from every stored entry
    expect(c.last_updated_at).toBe('2026-10-27T14:00:00Z');
  });

  it('a cleared status (null) counts as not done and as tracked', () => {
    const c = compute(base({ itemStatus: itemStatus({ '1': entry(null, '2026-10-27T14:00:00Z') }) }));
    expect(c.all_done).toBe(false);
    expect(c.untracked_count).toBe(0);
    expect(c.should_have_tag).toBe(true);
    expect(c.summary).toBe('0/1 done · Not set ×1 — Ahmed, Oct 27');
  });

  it('a first write of a non-done status wants the tag', () => {
    const c = compute(base({ itemStatus: itemStatus({ '1': entry('cad', '2026-10-27T14:00:00Z') }) }));
    expect(c.should_have_tag).toBe(true);
    expect(c.tracking).toBe('in_progress');
  });
});

describe('staleness', () => {
  it('one fresh done item plus one old open item ⇒ stale (per open item, not newest change)', () => {
    const c = compute(
      base({
        visible: [
          { id: '1', title: 'A' },
          { id: '2', title: 'B' },
        ],
        itemStatus: itemStatus({ '1': entry('sent_to_store', '2026-10-27T15:00:00Z'), '2': entry('cad', '2026-10-20T15:00:00Z') }),
      }),
    );
    expect(c.last_updated_at).toBe('2026-10-27T15:00:00Z');
    expect(c.stale_since).toBe('2026-10-20T15:00:00Z');
    expect(c.business_days_since_update).toBe(5);
    expect(c.stale).toBe(true);
    expect(c.stale_reason).toBe('no_update');
    expect(c.items.find((i) => i.id === '1')!.stale).toBe(false);
    expect(c.items.find((i) => i.id === '2')!.stale).toBe(true);
  });

  it('is not stale before the threshold and honours an override', () => {
    const s = itemStatus({ '1': entry('cad', '2026-10-23T20:00:00Z') }); // Friday 4 pm NY
    const c = compute(base({ itemStatus: s }));
    expect(c.business_days_since_update).toBe(2);
    expect(c.stale).toBe(false);
    expect(c.stale_reason).toBeNull();
    expect(compute(base({ itemStatus: s, staleAfterDays: 2 })).stale).toBe(true);
    expect(compute(base({ itemStatus: s, staleAfterDays: 2 })).stale_after_days).toBe(2);
  });

  it('every stale open item in a waiting status ⇒ reason waiting, blocked_on lists names', () => {
    const c = compute(
      base({
        visible: [
          { id: '1', title: 'A' },
          { id: '2', title: 'B' },
        ],
        itemStatus: itemStatus({ '1': entry('waiting_for_dia', '2026-10-15T15:00:00Z'), '2': entry('cad', '2026-10-27T15:00:00Z') }),
      }),
    );
    expect(c.stale).toBe(true);
    expect(c.stale_reason).toBe('waiting');
    expect(c.blocked_on).toEqual(['Waiting for DIA']);
  });

  it('shipped orders report shipped and are never stale', () => {
    const c = compute(base({ shipped: true, itemStatus: itemStatus({ '1': entry('cad', '2026-09-01T15:00:00Z') }) }));
    expect(c.stale).toBe(false);
    expect(c.stale_reason).toBe('shipped');
  });

  it('days_since_update is calendar time with one decimal', () => {
    const c = compute(base({ itemStatus: itemStatus({ '1': entry('cad', '2026-10-22T14:00:00Z') }) }));
    expect(c.days_since_update).toBe(5.1);
  });

  it('list mode without visible_ids reports untracked_count null and uses the item-count override', () => {
    const c = compute(base({ itemStatus: itemStatus({ '1': entry('cad', '2026-10-22T14:00:00Z') }), itemCountOverride: 4, untrackedUnknown: true }));
    expect(c.item_count).toBe(4);
    expect(c.untracked_count).toBeNull();
  });
});

describe('summary', () => {
  const s = settings();
  it('groups open items in dropdown order with the latest change', () => {
    const c = compute(
      base({
        visible: [
          { id: '1', title: 'A' },
          { id: '2', title: 'B' },
          { id: '3', title: 'C' },
        ],
        itemStatus: itemStatus({
          '1': entry('setting_igor', '2026-10-27T19:12:03Z', 'Ahmed'),
          '2': entry('cad', '2026-10-26T19:12:03Z', 'Igor'),
          '3': entry('cad', '2026-10-25T19:12:03Z', 'Igor'),
        }),
      }),
    );
    expect(c.summary).toBe('0/3 done · CAD ×2 · Setting Igor ×1 — Ahmed, Oct 27');
  });

  it('appends the year when it is not the current one', () => {
    const summary = buildSummary({
      hasEntries: true,
      doneItems: 1,
      itemCount: 1,
      openItems: [],
      settings: s,
      lastAt: '2025-12-31T23:30:00Z',
      lastBy: 'Ahmed',
      now,
      tz: TZ,
    });
    expect(summary).toBe('1/1 done — Ahmed, Dec 31, 2025');
  });

  it('stays within 200 chars by dropping groups and appending +k more', () => {
    const many = settings({ statuses: Array.from({ length: 30 }, (_, i) => ({ id: `s${i}`, name: `Very Long Status Name Number ${i}` })) });
    const items: Record<string, ReturnType<typeof entry>> = {};
    const visible = [];
    for (let i = 0; i < 30; i++) {
      items[String(i)] = entry(`s${i}`, '2026-10-27T14:00:00Z');
      visible.push({ id: String(i), title: 'x' });
    }
    const c = compute(base({ visible, itemStatus: itemStatus(items), settings: many }));
    expect(c.summary.length).toBeLessThanOrEqual(200);
    expect(c.summary).toMatch(/\+\d+ more — Ahmed, Oct 27$/);
    expect(c.summary.startsWith('0/30 done · Very Long Status Name Number 0 ×1')).toBe(true);
  });

  it('last_note is the note of the most recent history entry across items', () => {
    const a = entry('cad', '2026-10-20T10:00:00Z');
    a.history[0]!.note = 'old';
    const b = entry('mold', '2026-10-26T10:00:00Z');
    b.history[0]!.note = 'newest';
    const c = compute(
      base({
        visible: [
          { id: '1', title: 'A' },
          { id: '2', title: 'B' },
        ],
        itemStatus: itemStatus({ '1': a, '2': b }),
      }),
    );
    expect(c.last_note).toBe('newest');
  });
});
