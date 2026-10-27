import type { StaleReason, Tracking } from '@/lib/status/compute';
import type { HistoryKind, Source } from '@/lib/status/types';

/** API payloads (SPEC §7). `OrderPayload` is the credentialed shape; see shape.ts for the public one. */

export interface HistoryOut {
  kind: HistoryKind;
  status: string | null;
  status_name: string | null;
  at: string;
  by: string;
  via: string;
  source: Source;
  note: string;
}

export interface ItemOut {
  line_item_id: string;
  title: string;
  /** pill text: title — variant ×n (1 of 2) */
  label: string;
  variant_title: string | null;
  sku: string | null;
  quantity: number;
  current_quantity: number;
  position: number;
  attributes: Record<string, string>;
  status: string | null;
  status_name: string | null;
  done: boolean;
  waiting: boolean;
  days_since_update: number;
  stale: boolean;
  updated_at: string | null;
  updated_by: string | null;
  source: Source | null;
  via: string | null;
  /** oldest first, as stored */
  history: HistoryOut[];
}

export interface OrderMeta {
  number: string;
  id: string;
  created_at: string;
  admin_url: string;
  tags: string[];
  fulfillment_status: string;
  closed: boolean;
  cancelled_at: string | null;
}

export interface OrderContext {
  production_date: string | null;
  due_date: string | null;
  custody: string | null;
  give_to: string | null;
}

export interface StatusFields {
  tracking: Tracking;
  summary: string;
  last_updated_at: string | null;
  last_updated_by: string | null;
  stale_since: string | null;
  days_since_update: number | null;
  business_days_since_update: number | null;
  stale: boolean;
  stale_reason: StaleReason;
  stale_after_days: number;
  all_done: boolean;
  open_items: number;
  done_items: number;
  item_count: number;
  untracked_count: number | null;
  blocked_on: string[];
  last_note: string;
}

export interface OrderPayload extends StatusFields {
  order: OrderMeta;
  context: OrderContext;
  items: ItemOut[];
  untracked_items: { line_item_id: string; title: string; variant_title: string | null; position: number }[];
  removed_items: { line_item_id: string; title: string; status: string | null; status_name: string | null }[];
  hidden_items: { line_item_id: string; title: string }[];
  /** present only when the stored item_status failed validation */
  status_data_unreadable?: true;
  tag_synced: boolean;
}

/** List rows: no line items are fetched, so items carry only what item_status holds. */
export type ListItemOut = Pick<
  ItemOut,
  'line_item_id' | 'title' | 'label' | 'status' | 'status_name' | 'done' | 'waiting' | 'days_since_update' | 'stale' | 'updated_at' | 'updated_by' | 'source' | 'via'
>;

export interface ListRow extends StatusFields {
  order: OrderMeta;
  context: OrderContext;
  items: ListItemOut[];
}

export interface PublicItem {
  line_item_id: string;
  title: string;
  label: string;
  status: string | null;
  status_name: string | null;
  done: boolean;
  waiting: boolean;
  days_since_update: number;
  stale: boolean;
  updated_at: string | null;
  updated_by: string | null;
}

export interface PublicOrder extends Omit<StatusFields, 'last_note'> {
  order: { number: string };
  items: PublicItem[];
}

export interface UntrackedPublic {
  order: { number: string };
  tracked: false;
}
