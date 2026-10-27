/** Shapes stored in Shopify (SPEC §4) and the line-item view the logic works on. */

export type HistoryKind = 'set' | 'confirm' | 'clear';
export type Source = 'web' | 'api' | 'claude' | 'import';

export interface HistoryEntry {
  kind: HistoryKind;
  status: string | null;
  at: string;
  by: string;
  source: Source;
  via: string;
  note: string;
}

export interface ItemEntry {
  title: string;
  status: string | null;
  updated_at: string;
  updated_by: string;
  source: Source;
  via: string;
  history: HistoryEntry[];
}

export interface ItemStatus {
  v: 1;
  /** ids of the visible, non-removed line items as of the last write; absent on partial direct writes */
  visible_ids?: string[];
  /** null-prototype object keyed by numeric line item id */
  items: Record<string, ItemEntry>;
}

export interface StatusDef {
  id: string;
  name: string;
  done?: boolean;
  waiting?: boolean;
  retired?: boolean;
}

export interface Settings {
  v: 1;
  statuses: StatusDef[];
  stale_after_days: number;
  work_days: number[];
  hide_items_matching: string[];
  watch_query: string;
  admin_failed_attempts: number;
  admin_locked_until: string | null;
}

export interface StaffEntry {
  id: string;
  name: string;
  pin_hash: string | null;
  active: boolean;
  session_version: number;
  failed_attempts: number;
  locked_until: string | null;
}

export interface StaffRoster {
  v: 1;
  staff: StaffEntry[];
}

/** A line item as the app sees it (from `OrderByName`). */
export interface LineItem {
  /** numeric id as a string, e.g. "50788056399960" */
  id: string;
  title: string;
  variantTitle: string | null;
  sku: string | null;
  quantity: number;
  currentQuantity: number;
  requiresShipping: boolean;
  isGiftCard: boolean;
  customAttributes: { key: string; value: string | null }[];
  /** 1-based position on the order */
  position: number;
}

export interface Actor {
  by: string;
  source: Source;
  via: string;
}

export interface Change {
  lineItemId: string;
  status: string | null;
  note: string;
}

export const HISTORY_CAP = 30;
export const NOTE_MAX = 200;
export const ITEM_STATUS_MAX_BYTES = 100_000;
export const SUMMARY_MAX = 200;
export const PRODUCTION_TAG = 'trax-production';
export const NAMESPACE = 'trax_production';

export function createItems(): Record<string, ItemEntry> {
  return Object.create(null) as Record<string, ItemEntry>;
}

export function emptyItemStatus(): ItemStatus {
  return { v: 1, visible_ids: [], items: createItems() };
}
