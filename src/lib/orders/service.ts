import { getEnv } from '@/lib/env';
import { AppError, ShopifyRequestError, badRequest, conflict, notFound, tooLarge } from '@/lib/errors';
import { log } from '@/lib/log';
import { resolveStatus } from '@/lib/settings/model';
import { getSettings } from '@/lib/settings/store';
import { findUserErrorCode, shopifyGraphQL } from '@/lib/shopify/client';
import { AddTags, OrderByName, OrdersByQuery, RemoveTags, SetOrderStatus } from '@/lib/shopify/queries';
import type {
  MetafieldsSetData,
  MetafieldsSetInput,
  OrderByNameData,
  OrdersByQueryData,
  RawOrderNode,
  TagsAddData,
  TagsRemoveData,
} from '@/lib/shopify/types';
import { compute, statusIndex, type Computed, type VisibleRef } from '@/lib/status/compute';
import { classifyLineItems, lineItemIdFromGid, pillLabel, visibleAttributes, type Classified } from '@/lib/status/items';
import { applyChanges, trimToSize } from '@/lib/status/merge';
import { cloneItemStatus, parseItemStatus, serializeItemStatus } from '@/lib/status/schema';
import { NAMESPACE, PRODUCTION_TAG, SUMMARY_MAX, type Actor, type Change, type ItemStatus, type LineItem, type Settings } from '@/lib/status/types';
import { formatTimestamp, parseIsoLenient, parseTimestamp } from '@/lib/time';
import type { HistoryOut, ItemOut, ListItemOut, ListRow, OrderMeta, OrderPayload, PublicOrder } from './types';
import { publicShape } from './shape';

const PUBLIC_CACHE_TTL_MS = 15_000;
const LIST_CACHE_TTL_MS = 60_000;
const MAX_PAGES_PER_QUERY = 10;
const WRITE_ATTEMPTS = 4; // 1 + 3 retries on STALE_OBJECT

// ---------------------------------------------------------------------------------------
// Fetching

export async function fetchOrderByNumber(number: string): Promise<RawOrderNode | null> {
  const data = await shopifyGraphQL<OrderByNameData>(OrderByName, { q: `name:#${number}` });
  const wanted = Number(number);
  return data.orders.nodes.find((n) => n.number === wanted) ?? null;
}

function toLineItems(raw: RawOrderNode): LineItem[] {
  const out: LineItem[] = [];
  let position = 0;
  for (const li of raw.lineItems?.nodes ?? []) {
    position++;
    const id = lineItemIdFromGid(li.id);
    if (!id) continue;
    out.push({
      id,
      title: li.title ?? '',
      variantTitle: li.variantTitle ?? null,
      sku: li.sku ?? null,
      quantity: li.quantity ?? 0,
      currentQuantity: li.currentQuantity ?? 0,
      requiresShipping: li.requiresShipping ?? true,
      isGiftCard: li.isGiftCard ?? false,
      customAttributes: li.customAttributes ?? [],
      position,
    });
  }
  return out;
}

function isShipped(raw: RawOrderNode): boolean {
  return raw.displayFulfillmentStatus === 'FULFILLED' || raw.closed || Boolean(raw.cancelledAt);
}

function orderMeta(raw: RawOrderNode): OrderMeta {
  const created = parseIsoLenient(raw.createdAt);
  return {
    number: String(raw.number),
    id: raw.id,
    created_at: created ? formatTimestamp(created) : raw.createdAt,
    admin_url: `https://admin.shopify.com/store/${getEnv().SHOPIFY_ADMIN_HANDLE}/orders/${raw.legacyResourceId}`,
    tags: [...raw.tags],
    fulfillment_status: raw.displayFulfillmentStatus,
    closed: raw.closed,
    cancelled_at: raw.cancelledAt,
  };
}

function orderContext(raw: RawOrderNode) {
  return {
    production_date: raw.productionDate?.value ?? null,
    due_date: raw.dueDate?.value ?? null,
    custody: raw.custody?.value ?? null,
    give_to: raw.giveTo?.value ?? null,
  };
}

function createdAtOf(raw: RawOrderNode): Date {
  return parseIsoLenient(raw.createdAt) ?? new Date(0);
}

function statusFields(c: Computed) {
  return {
    tracking: c.tracking,
    summary: c.summary,
    last_updated_at: c.last_updated_at,
    last_updated_by: c.last_updated_by,
    stale_since: c.stale_since,
    days_since_update: c.days_since_update,
    business_days_since_update: c.business_days_since_update,
    stale: c.stale,
    stale_reason: c.stale_reason,
    stale_after_days: c.stale_after_days,
    all_done: c.all_done,
    open_items: c.open_items,
    done_items: c.done_items,
    item_count: c.item_count,
    untracked_count: c.untracked_count,
    blocked_on: c.blocked_on,
    last_note: c.last_note,
  };
}

// ---------------------------------------------------------------------------------------
// Single-order view

export interface OrderView {
  payload: Omit<OrderPayload, 'tag_synced'>;
  computed: Computed;
  itemStatus: ItemStatus | null;
  parseOk: boolean;
  raw: RawOrderNode;
  classified: Classified;
}

interface ViewOptions {
  settings: Settings;
  now: Date;
  itemStatusOverride?: ItemStatus | null;
  staleAfterDays?: number;
}

function buildView(raw: RawOrderNode, opts: ViewOptions): OrderView {
  const env = getEnv();
  const lineItems = toLineItems(raw);
  const classified = classifyLineItems(lineItems, opts.settings);
  let itemStatus: ItemStatus | null;
  let parseOk = true;
  if (opts.itemStatusOverride !== undefined) {
    itemStatus = opts.itemStatusOverride;
  } else {
    const parsed = parseItemStatus(raw.itemStatus?.value);
    if (parsed.ok) itemStatus = parsed.value;
    else {
      parseOk = false;
      itemStatus = null;
      log.warn('item_status unreadable', { order: raw.name, reason: parsed.reason });
    }
  }

  const visible: VisibleRef[] = classified.visible.map((li) => ({ id: li.id, title: li.title }));
  const computed = compute({
    itemStatus,
    visible,
    createdAt: createdAtOf(raw),
    shipped: isShipped(raw),
    settings: opts.settings,
    now: opts.now,
    tz: env.DISPLAY_TZ,
    staleAfterDays: opts.staleAfterDays,
  });
  const byId = statusIndex(opts.settings);
  const computedById = new Map(computed.items.map((i) => [i.id, i]));

  const items: ItemOut[] = classified.visible.map((li) => {
    const c = computedById.get(li.id);
    const entry = c?.entry ?? null;
    const history: HistoryOut[] = (entry?.history ?? []).map((h) => ({
      kind: h.kind,
      status: h.status,
      status_name: h.status ? (byId.get(h.status)?.name ?? h.status) : null,
      at: h.at,
      by: h.by,
      via: h.via,
      source: h.source,
      note: h.note,
    }));
    return {
      line_item_id: li.id,
      title: li.title,
      label: pillLabel(li, classified.visible),
      variant_title: li.variantTitle && li.variantTitle !== 'Default Title' ? li.variantTitle : null,
      sku: li.sku,
      quantity: li.quantity,
      current_quantity: li.currentQuantity,
      position: li.position,
      attributes: visibleAttributes(li),
      status: c?.status ?? null,
      status_name: c?.status_name ?? null,
      done: c?.done ?? false,
      waiting: c?.waiting ?? false,
      days_since_update: c?.days_since_update ?? 0,
      stale: c?.stale ?? false,
      updated_at: c?.updated_at ?? null,
      updated_by: c?.updated_by ?? null,
      source: entry?.source ?? null,
      via: entry?.via ?? null,
      history,
    };
  });

  const untracked = classified.visible
    .filter((li) => !itemStatus?.items[li.id])
    .map((li) => ({
      line_item_id: li.id,
      title: li.title,
      variant_title: li.variantTitle && li.variantTitle !== 'Default Title' ? li.variantTitle : null,
      position: li.position,
    }));

  const removed: OrderPayload['removed_items'] = classified.removed.map((li) => {
    const entry = itemStatus?.items[li.id] ?? null;
    return {
      line_item_id: li.id,
      title: li.title,
      status: entry?.status ?? null,
      status_name: entry?.status ? (byId.get(entry.status)?.name ?? entry.status) : null,
    };
  });
  if (itemStatus) {
    const known = new Set(lineItems.map((li) => li.id));
    for (const id of Object.keys(itemStatus.items)) {
      if (known.has(id)) continue;
      const entry = itemStatus.items[id];
      if (!entry) continue;
      removed.push({
        line_item_id: id,
        title: entry.title,
        status: entry.status,
        status_name: entry.status ? (byId.get(entry.status)?.name ?? entry.status) : null,
      });
    }
  }

  const payload: Omit<OrderPayload, 'tag_synced'> = {
    order: orderMeta(raw),
    context: orderContext(raw),
    ...statusFields(computed),
    items,
    untracked_items: untracked,
    removed_items: removed,
    hidden_items: classified.hidden.map((li) => ({ line_item_id: li.id, title: li.title })),
  };
  if (!parseOk) payload.status_data_unreadable = true;

  return { payload, computed, itemStatus, parseOk, raw, classified };
}

// ---------------------------------------------------------------------------------------
// Writes to Shopify

interface MetafieldWrite {
  stale: boolean;
  digest: string | null;
}

async function setOrderMetafields(orderId: string, itemStatus: ItemStatus, computed: Computed, digest: string | null): Promise<MetafieldWrite> {
  const metafields: MetafieldsSetInput[] = [
    { ownerId: orderId, namespace: NAMESPACE, key: 'item_status', type: 'json', value: serializeItemStatus(itemStatus), compareDigest: digest },
  ];
  if (computed.last_updated_at && computed.last_updated_by) {
    metafields.push(
      { ownerId: orderId, namespace: NAMESPACE, key: 'last_updated_at', type: 'date_time', value: computed.last_updated_at },
      { ownerId: orderId, namespace: NAMESPACE, key: 'last_updated_by', type: 'single_line_text_field', value: computed.last_updated_by.slice(0, SUMMARY_MAX) },
    );
  }
  metafields.push({ ownerId: orderId, namespace: NAMESPACE, key: 'summary', type: 'single_line_text_field', value: computed.summary.slice(0, SUMMARY_MAX) });

  const data = await shopifyGraphQL<MetafieldsSetData>(SetOrderStatus, { metafields });
  const errors = data.metafieldsSet?.userErrors ?? [];
  if (errors.length > 0) {
    const code = findUserErrorCode(errors, ['STALE_OBJECT', 'INVALID_COMPARE_DIGEST']);
    if (code === 'STALE_OBJECT') return { stale: true, digest: null };
    if (code === 'INVALID_COMPARE_DIGEST') {
      throw new AppError(500, 'internal_error', 'Internal error', { detail: `INVALID_COMPARE_DIGEST on ${orderId}` });
    }
    throw new ShopifyRequestError(JSON.stringify(errors), { operation: 'SetOrderStatus' });
  }
  const written = data.metafieldsSet?.metafields?.find((m) => m.key === 'item_status');
  return { stale: false, digest: written?.compareDigest ?? null };
}

async function setTag(orderId: string, present: boolean): Promise<void> {
  if (present) {
    const data = await shopifyGraphQL<TagsAddData>(AddTags, { id: orderId, tags: [PRODUCTION_TAG] });
    const errors = data.tagsAdd?.userErrors ?? [];
    if (errors.length > 0) throw new ShopifyRequestError(JSON.stringify(errors), { operation: 'AddTags' });
  } else {
    const data = await shopifyGraphQL<TagsRemoveData>(RemoveTags, { id: orderId, tags: [PRODUCTION_TAG] });
    const errors = data.tagsRemove?.userErrors ?? [];
    if (errors.length > 0) throw new ShopifyRequestError(JSON.stringify(errors), { operation: 'RemoveTags' });
  }
}

/** Make the tag match `shouldHaveTag`; never throws — returns whether it is in sync. */
async function syncTag(raw: RawOrderNode, shouldHaveTag: boolean): Promise<boolean> {
  const hasTag = raw.tags.includes(PRODUCTION_TAG);
  if (hasTag === shouldHaveTag) return true;
  try {
    await setTag(raw.id, shouldHaveTag);
    raw.tags = shouldHaveTag ? [...raw.tags, PRODUCTION_TAG] : raw.tags.filter((t) => t !== PRODUCTION_TAG);
    log.info('order tag synced', { order: raw.name, tag: PRODUCTION_TAG, present: shouldHaveTag });
    return true;
  } catch (e) {
    log.error('tag mutation failed', { order: raw.name, present: shouldHaveTag, detail: e instanceof AppError ? e.detail : String(e) });
    return false;
  }
}

function sameTimestamp(a: string | null | undefined, b: string | null): boolean {
  const da = a ? parseIsoLenient(a) : null;
  const db = b ? parseIsoLenient(b) : null;
  if (!da || !db) return !da && !db;
  return da.getTime() === db.getTime();
}

function sameIds(a: readonly string[] | undefined, b: readonly string[]): boolean {
  if (!a || a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

/**
 * Self-healing on read (SPEC §4.6): when Shopify holds derived data that differs from what
 * `item_status` implies, rewrite it (with compareDigest) and fix the tag. Awaited, logged,
 * never fails the read.
 */
async function repair(view: OrderView): Promise<boolean> {
  const { raw, computed } = view;
  try {
    if (view.parseOk && view.itemStatus && computed.has_entries) {
      const needsMeta =
        !sameTimestamp(raw.lastUpdatedAt?.value, computed.last_updated_at) ||
        (raw.lastUpdatedBy?.value ?? null) !== computed.last_updated_by ||
        (raw.summary?.value ?? null) !== computed.summary.slice(0, SUMMARY_MAX) ||
        !sameIds(view.itemStatus.visible_ids, computed.visible_ids);
      if (needsMeta) {
        const next = cloneItemStatus(view.itemStatus);
        next.visible_ids = computed.visible_ids;
        const res = await setOrderMetafields(raw.id, next, computed, raw.itemStatus?.compareDigest ?? null);
        if (res.stale) log.warn('repair skipped: item_status changed meanwhile', { order: raw.name });
        else log.info('derived metafields repaired', { order: raw.name });
      }
    }
    return await syncTag(raw, computed.should_have_tag);
  } catch (e) {
    log.error('repair failed', { order: raw.name, detail: e instanceof AppError ? (e.detail ?? e.message) : String(e) });
    return false;
  }
}

// ---------------------------------------------------------------------------------------
// Public API of this module

const publicCache = new Map<string, { expires: number; body: PublicOrder | { order: { number: string }; tracked: false } }>();

export function invalidateOrderCaches(number?: string): void {
  if (number) publicCache.delete(number);
  else publicCache.clear();
  listCache = null;
}

/** Credentialed read with repair. Throws 404 when the order does not exist. */
export async function readOrder(number: string, opts: { repair?: boolean; staleAfterDays?: number } = {}): Promise<OrderPayload> {
  const raw = await fetchOrderByNumber(number);
  if (!raw) throw notFound('order_not_found', 'Order not found');
  const settings = await getSettings();
  const view = buildView(raw, { settings, now: new Date(), staleAfterDays: opts.staleAfterDays });
  const tagSynced = opts.repair === false ? raw.tags.includes(PRODUCTION_TAG) === view.computed.should_have_tag : await repair(view);
  return { ...view.payload, order: orderMeta(raw), tag_synced: tagSynced };
}

/**
 * Unauthenticated read: public shape, 15 s cache, `tracked: false` for an order outside the
 * production universe (no item_status, no tag, no watch-query match).
 */
export async function readOrderPublic(number: string): Promise<PublicOrder | { order: { number: string }; tracked: false }> {
  const hit = publicCache.get(number);
  if (hit && hit.expires > Date.now()) return hit.body;
  const payload = await readOrder(number);
  let body: PublicOrder | { order: { number: string }; tracked: false };
  if (payload.tracking === 'never_set' && !payload.order.tags.includes(PRODUCTION_TAG) && !(await universeHas(payload.order.id))) {
    body = { order: { number }, tracked: false };
  } else {
    body = publicShape(payload);
  }
  publicCache.set(number, { expires: Date.now() + PUBLIC_CACHE_TTL_MS, body });
  return body;
}

export interface RawChange {
  lineItemId: string;
  /** status id or name, or null to clear */
  status: string | null;
  note: string;
}

/** Validate, merge, write with CAS (retry on STALE_OBJECT), then sync the tag. */
export async function writeOrderStatus(number: string, changes: readonly RawChange[], actor: Actor): Promise<OrderPayload> {
  if (changes.length === 0) throw badRequest('no_changes', 'Nothing to update');
  const env = getEnv();
  for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt++) {
    const raw = await fetchOrderByNumber(number);
    if (!raw) throw notFound('order_not_found', 'Order not found');
    const settings = await getSettings();
    const now = new Date();
    const lineItems = toLineItems(raw);
    const classified = classifyLineItems(lineItems, settings);
    const visibleById = new Map(classified.visible.map((li) => [li.id, li]));
    const hiddenIds = new Set(classified.hidden.map((li) => li.id));
    const removedIds = new Set(classified.removed.map((li) => li.id));

    const resolved: Change[] = [];
    for (const change of changes) {
      if (hiddenIds.has(change.lineItemId)) {
        throw badRequest('item_hidden', `Line item ${change.lineItemId} is not a production item`);
      }
      if (removedIds.has(change.lineItemId)) {
        throw badRequest('item_removed', `Line item ${change.lineItemId} was removed from the order`);
      }
      if (!visibleById.has(change.lineItemId)) {
        throw notFound('item_not_found', `Line item ${change.lineItemId} is not on order #${number}`);
      }
      let statusId: string | null = null;
      if (change.status !== null) {
        const def = resolveStatus(settings, change.status);
        if (!def) {
          throw badRequest('unknown_status', `Unknown status "${change.status.slice(0, 60)}"`, {
            valid_statuses: settings.statuses.filter((s) => !s.retired).map((s) => s.name),
          });
        }
        statusId = def.id;
      }
      resolved.push({ lineItemId: change.lineItemId, status: statusId, note: change.note });
    }

    const parsed = parseItemStatus(raw.itemStatus?.value);
    let current: ItemStatus | null = null;
    if (parsed.ok) current = parsed.value;
    else log.warn('item_status unreadable — starting from empty', { order: raw.name, reason: parsed.reason });

    const titles = new Map(classified.visible.map((li) => [li.id, li.title]));
    const { next } = applyChanges(current, resolved, actor, titles, now);
    const computed = compute({
      itemStatus: next,
      visible: classified.visible.map((li) => ({ id: li.id, title: li.title })),
      createdAt: createdAtOf(raw),
      shipped: isShipped(raw),
      settings,
      now,
      tz: env.DISPLAY_TZ,
    });
    next.visible_ids = computed.visible_ids;
    const trimmed = trimToSize(next);
    if (!trimmed) throw tooLarge('item_status_too_large', 'Status history is too large to store');

    const res = await setOrderMetafields(raw.id, trimmed, computed, raw.itemStatus?.compareDigest ?? null);
    if (res.stale) {
      log.warn('STALE_OBJECT on write, retrying', { order: raw.name, attempt });
      continue;
    }

    const tagSynced = await syncTag(raw, computed.should_have_tag);
    invalidateOrderCaches(number);
    const written: RawOrderNode = { ...raw, itemStatus: { value: serializeItemStatus(trimmed), compareDigest: res.digest } };
    const view = buildView(written, { settings, now, itemStatusOverride: trimmed });
    log.info('status written', { order: raw.name, by: actor.by, via: actor.via, items: resolved.length, tag_synced: tagSynced });
    return { ...view.payload, tag_synced: tagSynced };
  }
  throw conflict();
}

// ---------------------------------------------------------------------------------------
// Lists (the production universe)

interface ListCache {
  nodes: RawOrderNode[];
  truncated: boolean;
  checkedAt: string;
  expires: number;
}

let listCache: ListCache | null = null;
let listInflight: Promise<ListCache> | null = null;

async function walk(q: string): Promise<{ nodes: RawOrderNode[]; truncated: boolean }> {
  const nodes: RawOrderNode[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES_PER_QUERY; page++) {
    const data: OrdersByQueryData = await shopifyGraphQL<OrdersByQueryData>(OrdersByQuery, { q, cursor });
    nodes.push(...data.orders.nodes);
    if (!data.orders.pageInfo.hasNextPage) return { nodes, truncated: false };
    cursor = data.orders.pageInfo.endCursor;
    if (!cursor) return { nodes, truncated: false };
  }
  return { nodes, truncated: true };
}

/** Every list query adds `status:open` (SPEC §4.2). */
export function withOpenFilter(query: string): string {
  const q = query.trim();
  if (!q) return q;
  return /\bstatus:/i.test(q) ? q : `(${q}) status:open`;
}

async function loadUniverse(fresh: boolean): Promise<ListCache> {
  if (!fresh && listCache && listCache.expires > Date.now()) return listCache;
  if (listInflight) return listInflight;
  listInflight = (async () => {
    try {
      const settings = await getSettings();
      const tagged = await walk(`tag:${PRODUCTION_TAG} AND status:open`);
      let truncated = tagged.truncated;
      const byId = new Map<string, RawOrderNode>();
      for (const n of tagged.nodes) byId.set(n.id, n);
      const watch = withOpenFilter(settings.watch_query);
      if (watch) {
        const w = await walk(watch);
        truncated = truncated || w.truncated;
        for (const n of w.nodes) if (!byId.has(n.id)) byId.set(n.id, n);
      }
      const nodes = [...byId.values()].filter((n) => n.displayFulfillmentStatus !== 'FULFILLED');
      listCache = { nodes, truncated, checkedAt: formatTimestamp(new Date()), expires: Date.now() + LIST_CACHE_TTL_MS };
      return listCache;
    } finally {
      listInflight = null;
    }
  })();
  return listInflight;
}

async function universeHas(orderId: string): Promise<boolean> {
  const u = await loadUniverse(false);
  return u.nodes.some((n) => n.id === orderId);
}

function buildListRow(raw: RawOrderNode, settings: Settings, now: Date, staleAfterDays?: number): ListRow {
  const env = getEnv();
  const parsed = parseItemStatus(raw.itemStatus?.value);
  const itemStatus = parsed.ok ? parsed.value : null;
  if (!parsed.ok) log.warn('item_status unreadable in list', { order: raw.name, reason: parsed.reason });

  let visible: VisibleRef[];
  let itemCountOverride: number | undefined;
  let untrackedUnknown = false;
  const fallbackCount = Math.max(0, raw.currentSubtotalLineItemsQuantity ?? 0);
  if (itemStatus?.visible_ids) {
    visible = itemStatus.visible_ids.map((id) => ({ id, title: itemStatus.items[id]?.title ?? null }));
  } else if (itemStatus && Object.keys(itemStatus.items).length > 0) {
    visible = Object.keys(itemStatus.items).map((id) => ({ id, title: itemStatus.items[id]?.title ?? null }));
    itemCountOverride = fallbackCount;
    untrackedUnknown = true;
  } else {
    // never set: every item is open since the order was created
    visible = Array.from({ length: Math.max(1, fallbackCount) }, () => ({ id: '', title: null }));
    itemCountOverride = fallbackCount;
  }

  const computed = compute({
    itemStatus,
    visible,
    createdAt: createdAtOf(raw),
    shipped: isShipped(raw),
    settings,
    now,
    tz: env.DISPLAY_TZ,
    staleAfterDays,
    itemCountOverride,
    untrackedUnknown,
  });

  const items: ListItemOut[] = computed.items
    .filter((i) => i.entry !== null && i.id !== '')
    .map((i) => ({
      line_item_id: i.id,
      title: i.title,
      label: i.title,
      status: i.status,
      status_name: i.status_name,
      done: i.done,
      waiting: i.waiting,
      days_since_update: i.days_since_update,
      stale: i.stale,
      updated_at: i.updated_at,
      updated_by: i.updated_by,
      source: i.entry?.source ?? null,
      via: i.entry?.via ?? null,
    }));

  return { order: orderMeta(raw), context: orderContext(raw), ...statusFields(computed), items };
}

function rank(row: ListRow): number {
  if (row.tracking === 'never_set') return 0;
  if (row.stale_since !== null) return 1;
  return 2;
}

export function sortRows(rows: ListRow[]): ListRow[] {
  return [...rows].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 1) return (a.stale_since ?? '').localeCompare(b.stale_since ?? '');
    return a.order.created_at.localeCompare(b.order.created_at);
  });
}

export interface UniverseResult {
  rows: ListRow[];
  truncated: boolean;
  checked_at: string;
}

/** The production universe as sorted rows (stalest first). */
export async function listUniverse(opts: { fresh?: boolean; staleAfterDays?: number } = {}): Promise<UniverseResult> {
  const u = await loadUniverse(Boolean(opts.fresh));
  const settings = await getSettings();
  const now = new Date();
  const rows = sortRows(u.nodes.map((n) => buildListRow(n, settings, now, opts.staleAfterDays)));
  return { rows, truncated: u.truncated, checked_at: u.checkedAt };
}

export const _internal = { buildView, buildListRow, toLineItems };
export { parseTimestamp };
