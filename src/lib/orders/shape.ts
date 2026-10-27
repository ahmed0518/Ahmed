import type { ListRow, OrderPayload, PublicItem, PublicOrder } from './types';

/**
 * The public shape (SPEC §7): no ledger data — no dates other than the status timestamps,
 * no tags, notes, custody, history, ids or admin links. Order numbers are sequential, so an
 * unauthenticated caller learns nothing beyond the production status itself.
 */
export function publicItem(i: ListRow['items'][number] | OrderPayload['items'][number]): PublicItem {
  return {
    line_item_id: i.line_item_id,
    title: i.title,
    label: i.label,
    status: i.status,
    status_name: i.status_name,
    done: i.done,
    waiting: i.waiting,
    days_since_update: i.days_since_update,
    stale: i.stale,
    updated_at: i.updated_at,
    updated_by: i.updated_by,
  };
}

export function publicShape(p: OrderPayload | ListRow): PublicOrder {
  return {
    order: { number: p.order.number },
    tracking: p.tracking,
    summary: p.summary,
    last_updated_at: p.last_updated_at,
    last_updated_by: p.last_updated_by,
    stale_since: p.stale_since,
    days_since_update: p.days_since_update,
    business_days_since_update: p.business_days_since_update,
    stale: p.stale,
    stale_reason: p.stale_reason,
    stale_after_days: p.stale_after_days,
    all_done: p.all_done,
    open_items: p.open_items,
    done_items: p.done_items,
    item_count: p.item_count,
    untracked_count: p.untracked_count,
    blocked_on: [...p.blocked_on],
    items: p.items.map(publicItem),
  };
}
