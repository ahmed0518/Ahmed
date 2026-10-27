import { beforeAll, describe, expect, it } from 'vitest';
import { resetEnvCache } from '@/lib/env';
import { _internal } from '@/lib/orders/service';
import type { RawOrderNode } from '@/lib/shopify/types';
import { TZ, entry, itemStatus, ny, settings } from './helpers';

/** List rows (SPEC §7.2): built from `item_status` + `currentSubtotalLineItemsQuantity`, never from line items. */

const now = ny('2026-10-27T12:00:00'); // Tuesday

function node(overrides: Partial<RawOrderNode> = {}): RawOrderNode {
  return {
    id: 'gid://shopify/Order/1',
    legacyResourceId: '1',
    name: '#251548',
    number: 251548,
    createdAt: '2026-10-14T05:46:01Z',
    closed: false,
    cancelledAt: null,
    displayFulfillmentStatus: 'UNFULFILLED',
    tags: ['custom-item-order'],
    currentSubtotalLineItemsQuantity: 3,
    itemStatus: null,
    productionDate: null,
    custody: null,
    giveTo: null,
    dueDate: null,
    ...overrides,
  };
}

describe('list rows', () => {
  beforeAll(() => {
    // buildListRow reads DISPLAY_TZ and the admin handle from the validated environment
    Object.assign(process.env, {
      SHOPIFY_STORE_DOMAIN: 'mock-store.myshopify.com',
      SHOPIFY_ADMIN_TOKEN: 'shpat_unit_test',
      SESSION_SECRET: 'a'.repeat(64),
      PIN_PEPPER: 'b'.repeat(64),
      DISPLAY_TZ: TZ,
    });
    resetEnvCache();
  });

  it('a never-set row counts Shopify lines and is stale from the order date', () => {
    const row = _internal.buildListRow(node(), settings(), now);
    expect(row).toMatchObject({ tracking: 'never_set', item_count: 3, open_items: 3, untracked_count: null, stale: true, stale_reason: 'never_set', summary: 'No status yet' });
    expect(row.stale_since).toBe('2026-10-14T05:46:01Z');
    expect(row.items).toEqual([]);
  });

  it('a never-set row with no live lines (every line removed) has nothing open and is not chased', () => {
    const row = _internal.buildListRow(node({ currentSubtotalLineItemsQuantity: 0 }), settings(), now);
    expect(row).toMatchObject({ tracking: 'never_set', item_count: 0, open_items: 0, untracked_count: null, stale: false, stale_reason: null, all_done: true });
    expect(row.open_items).toBeLessThanOrEqual(row.item_count);
  });

  it('a tracked row uses visible_ids for its counts and lists only items that hold an entry', () => {
    const status = itemStatus({ '1': entry('cad', '2026-10-20T15:00:00Z') }, ['1', '2']);
    const row = _internal.buildListRow(node({ itemStatus: { value: JSON.stringify(status), compareDigest: 'x' }, tags: ['trax-production'] }), settings(), now);
    expect(row).toMatchObject({ tracking: 'in_progress', item_count: 2, open_items: 2, untracked_count: 1, stale: true, stale_reason: 'no_update' });
    expect(row.items.map((i) => i.line_item_id)).toEqual(['1']);
  });
});
