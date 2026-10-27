import Link from 'next/link';
import type { ListRow, PublicOrder } from '@/lib/orders/types';
import { formatMonD } from '@/lib/time';
import { RelativeTime } from './RelativeTime';

type Row = ListRow | (PublicOrder & { order: { number: string; created_at?: string } });

/**
 * `{tracked}/{item_count} items` when the row knows its visible items (`visible_ids`);
 * otherwise `item_count` is the Shopify line quantity, hidden lines included, so the row says
 * `N lines` instead of pretending to know how many production items are untracked.
 */
function countLabel(r: Row): string {
  if (r.untracked_count === null) return `${r.item_count} ${r.item_count === 1 ? 'line' : 'lines'}`;
  const tracked = Math.max(0, r.item_count - r.untracked_count);
  return `${tracked}/${r.item_count} ${r.item_count === 1 ? 'item' : 'items'}`;
}

/** List rows for the home page: order #, counts, summary, last updated, badges. */
export function OrderRows({ rows, tz, now }: { rows: Row[]; tz: string; now: Date }) {
  if (rows.length === 0) return <p className="muted">Nothing here.</p>;
  return (
    <ul className="list">
      {rows.map((r) => {
        const createdAt = 'created_at' in r.order ? r.order.created_at : undefined;
        return (
          <li key={r.order.number}>
            <Link href={`/orders/${r.order.number}`} className="list__item" data-testid={`row-${r.order.number}`}>
              <div className="list__head">
                <span className="list__number">#{r.order.number}</span>
                <span className="muted">{countLabel(r)}</span>
                <span className="row">
                  {r.stale ? <span className="badge badge--stale">stale</span> : null}
                  {r.blocked_on.length > 0 ? <span className="badge badge--waiting">waiting</span> : null}
                  {r.all_done ? <span className="badge badge--done">done</span> : null}
                </span>
              </div>
              <div className="small">{r.summary}</div>
              <div className="muted">
                {r.last_updated_at ? (
                  <>
                    Last updated <RelativeTime iso={r.last_updated_at} tz={tz} fallback={formatMonD(new Date(r.last_updated_at), tz, now)} /> by{' '}
                    {r.last_updated_by}
                  </>
                ) : createdAt ? (
                  <>
                    No status yet · ordered <RelativeTime iso={createdAt} tz={tz} fallback={formatMonD(new Date(createdAt), tz, now)} />
                  </>
                ) : (
                  <>No status yet</>
                )}
                {r.blocked_on.length > 0 ? <> · waiting on {r.blocked_on.join(', ')}</> : null}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
