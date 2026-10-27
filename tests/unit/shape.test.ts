import { describe, expect, it } from 'vitest';
import { publicShape } from '@/lib/orders/shape';
import type { OrderPayload } from '@/lib/orders/types';

const payload: OrderPayload = {
  order: {
    number: '251548',
    id: 'gid://shopify/Order/1',
    created_at: '2026-10-14T05:46:01Z',
    admin_url: 'https://admin.shopify.com/store/x/orders/1',
    tags: ['custom-item-order', 'trax-production'],
    fulfillment_status: 'UNFULFILLED',
    closed: false,
    cancelled_at: null,
  },
  context: { production_date: 'Ships by Fri', due_date: '2026-10-30', custody: 'Bench 2', give_to: 'Igor' },
  tracking: 'in_progress',
  summary: '0/1 done · CAD ×1 — Ahmed, Oct 27',
  last_updated_at: '2026-10-27T15:12:03Z',
  last_updated_by: 'Ahmed',
  stale_since: '2026-10-27T15:12:03Z',
  days_since_update: 0.1,
  business_days_since_update: 0,
  stale: false,
  stale_reason: null,
  stale_after_days: 3,
  all_done: false,
  open_items: 1,
  done_items: 0,
  item_count: 1,
  untracked_count: 0,
  blocked_on: [],
  last_note: 'secret note',
  items: [
    {
      line_item_id: '1',
      title: 'Bracelet',
      label: 'Bracelet — Gold',
      variant_title: 'Gold',
      sku: 'SKU1',
      quantity: 1,
      current_quantity: 1,
      position: 1,
      attributes: { Engraving: 'MOM' },
      status: 'cad',
      status_name: 'CAD',
      done: false,
      waiting: false,
      days_since_update: 0.1,
      stale: false,
      updated_at: '2026-10-27T15:12:03Z',
      updated_by: 'Ahmed',
      source: 'web',
      via: 'web:Ahmed',
      history: [{ kind: 'set', status: 'cad', status_name: 'CAD', at: '2026-10-27T15:12:03Z', by: 'Ahmed', via: 'web:Ahmed', source: 'web', note: 'secret note' }],
    },
  ],
  untracked_items: [],
  removed_items: [{ line_item_id: '2', title: 'Gone', status: 'mold', status_name: 'Mold' }],
  hidden_items: [{ line_item_id: '3', title: 'Warranty' }],
  tag_synced: true,
};

describe('public shape', () => {
  it('carries status data only — no ledger fields, history, context or tags', () => {
    const pub = publicShape(payload);
    expect(Object.keys(pub.order)).toEqual(['number']);
    expect(Object.keys(pub).sort()).toEqual(
      [
        'order', 'tracking', 'summary', 'last_updated_at', 'last_updated_by', 'stale_since', 'days_since_update', 'business_days_since_update',
        'stale', 'stale_reason', 'stale_after_days', 'all_done', 'open_items', 'done_items', 'item_count', 'untracked_count', 'blocked_on', 'items',
      ].sort(),
    );
    expect(Object.keys(pub.items[0]!).sort()).toEqual(
      ['line_item_id', 'title', 'label', 'status', 'status_name', 'done', 'waiting', 'days_since_update', 'stale', 'updated_at', 'updated_by'].sort(),
    );
    const text = JSON.stringify(pub);
    for (const forbidden of ['pin_hash', 'history', 'context', 'tags', 'admin_url', 'secret note', 'Bench 2', 'via', 'source', 'removed_items', 'hidden_items', 'gid://']) {
      expect(text, forbidden).not.toContain(forbidden);
    }
  });
});
