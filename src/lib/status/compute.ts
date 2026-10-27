import { businessDaysSince, daysSince, formatMonD, formatTimestamp, parseTimestamp } from '@/lib/time';
import { SUMMARY_MAX, type ItemEntry, type ItemStatus, type Settings, type StatusDef } from './types';

/**
 * The one pure derivation (SPEC §4.6 / §7): from `item_status` + the visible items it
 * produces the derived metafields, the tag state, counts, per-item state and staleness.
 * Works in two modes: with line items (single-order read) or with `visible_ids` (list rows).
 */

export type Tracking = 'never_set' | 'in_progress' | 'all_done';
export type StaleReason = 'never_set' | 'no_update' | 'waiting' | 'shipped' | null;

export interface VisibleRef {
  id: string;
  /** title from the line item, or from the stored entry in list mode (null when unknown) */
  title: string | null;
}

export interface ComputeInput {
  itemStatus: ItemStatus | null;
  visible: readonly VisibleRef[];
  createdAt: Date;
  shipped: boolean;
  settings: Settings;
  now: Date;
  tz: string;
  /** overrides settings.stale_after_days (GET /api/stale?days=) */
  staleAfterDays?: number;
  /** list rows without visible_ids: untracked_count is unknown and item_count comes from Shopify */
  itemCountOverride?: number;
  untrackedUnknown?: boolean;
}

export interface ItemComputed {
  id: string;
  title: string;
  entry: ItemEntry | null;
  status: string | null;
  status_name: string | null;
  done: boolean;
  waiting: boolean;
  open: boolean;
  updated_at: string | null;
  updated_by: string | null;
  days_since_update: number;
  business_days_since_update: number;
  stale: boolean;
}

export interface Computed {
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
  items: ItemComputed[];
  visible_ids: string[];
  should_have_tag: boolean;
  has_entries: boolean;
}

export function statusIndex(settings: Settings): Map<string, StatusDef> {
  const m = new Map<string, StatusDef>();
  for (const s of settings.statuses) m.set(s.id, s);
  return m;
}

export function compute(input: ComputeInput): Computed {
  const { itemStatus, visible, createdAt, shipped, settings, now, tz } = input;
  const threshold = input.staleAfterDays ?? settings.stale_after_days;
  const byId = statusIndex(settings);
  const entries = itemStatus ? itemStatus.items : null;
  const entryIds = entries ? Object.keys(entries) : [];
  const hasEntries = entryIds.length > 0;

  const items: ItemComputed[] = visible.map((ref) => {
    const entry = entries ? (entries[ref.id] ?? null) : null;
    const def = entry?.status ? byId.get(entry.status) : undefined;
    const done = Boolean(def?.done);
    const waiting = Boolean(def?.waiting);
    const updated = entry ? parseTimestamp(entry.updated_at) : null;
    const since = updated ?? createdAt;
    const bd = businessDaysSince(since, now, settings.work_days, tz);
    const open = !done;
    return {
      id: ref.id,
      title: ref.title ?? entry?.title ?? '',
      entry,
      status: entry?.status ?? null,
      status_name: entry?.status ? (def?.name ?? entry.status) : null,
      done,
      waiting,
      open,
      updated_at: updated ? formatTimestamp(updated) : null,
      updated_by: entry?.updated_by ?? null,
      days_since_update: daysSince(since, now),
      business_days_since_update: bd,
      stale: open && !shipped && bd >= threshold,
    };
  });

  const openItems = items.filter((i) => i.open);
  const doneItems = items.length - openItems.length;
  const allDone = openItems.length === 0;
  const tracking: Tracking = !hasEntries ? 'never_set' : allDone ? 'all_done' : 'in_progress';

  // Staleness is per open item: the oldest open item decides.
  let staleSince: Date | null = null;
  for (const i of openItems) {
    const since = i.entry ? (parseTimestamp(i.entry.updated_at) ?? createdAt) : createdAt;
    if (!staleSince || since < staleSince) staleSince = since;
  }
  const bd = staleSince ? businessDaysSince(staleSince, now, settings.work_days, tz) : null;
  const stale = !shipped && !allDone && bd !== null && bd >= threshold;
  let staleReason: StaleReason = null;
  if (shipped) staleReason = 'shipped';
  else if (stale) {
    const staleOpen = openItems.filter((i) => i.stale);
    if (!hasEntries) staleReason = 'never_set';
    else if (staleOpen.length > 0 && staleOpen.every((i) => i.waiting)) staleReason = 'waiting';
    else staleReason = 'no_update';
  }

  const blockedOn: string[] = [];
  for (const def of settings.statuses) {
    if (def.waiting && openItems.some((i) => i.status === def.id)) blockedOn.push(def.name);
  }

  // Most recent change over every stored entry (including removed items).
  let lastAt: string | null = null;
  let lastBy: string | null = null;
  let lastNote = '';
  let lastNoteAt = '';
  if (entries) {
    for (const id of entryIds) {
      const e = entries[id];
      if (!e) continue;
      if (lastAt === null || e.updated_at > lastAt) {
        lastAt = e.updated_at;
        lastBy = e.updated_by;
      }
      for (const h of e.history) {
        if (h.at >= lastNoteAt) {
          lastNoteAt = h.at;
          lastNote = h.note;
        }
      }
    }
  }

  const itemCount = input.itemCountOverride ?? items.length;
  const untrackedCount = input.untrackedUnknown ? null : items.filter((i) => i.entry === null).length;

  const summary = buildSummary({
    hasEntries,
    doneItems,
    itemCount,
    openItems,
    settings,
    lastAt,
    lastBy,
    now,
    tz,
  });

  return {
    tracking,
    summary,
    last_updated_at: lastAt,
    last_updated_by: lastBy,
    stale_since: staleSince ? formatTimestamp(staleSince) : null,
    days_since_update: staleSince ? daysSince(staleSince, now) : null,
    business_days_since_update: bd,
    stale,
    stale_reason: staleReason,
    stale_after_days: threshold,
    all_done: allDone,
    open_items: openItems.length,
    done_items: doneItems,
    item_count: itemCount,
    untracked_count: untrackedCount,
    blocked_on: blockedOn,
    last_note: lastNote,
    items,
    visible_ids: visible.map((v) => v.id),
    should_have_tag: hasEntries && !allDone,
    has_entries: hasEntries,
  };
}

interface SummaryInput {
  hasEntries: boolean;
  doneItems: number;
  itemCount: number;
  openItems: readonly ItemComputed[];
  settings: Settings;
  lastAt: string | null;
  lastBy: string | null;
  now: Date;
  tz: string;
}

/**
 * `0/2 done · CAD ×1 · Setting Igor ×1 — Ahmed, Oct 27` (≤ 200 chars; groups dropped from the
 * end with ` +{k} more`). Nothing set: `No status yet`.
 */
export function buildSummary(s: SummaryInput): string {
  if (!s.hasEntries) return 'No status yet';
  const counts = new Map<string, number>();
  for (const i of s.openItems) {
    const key = i.status ?? '';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const groups: string[] = [];
  for (const def of s.settings.statuses) {
    const n = counts.get(def.id);
    if (n) {
      groups.push(`${def.name} ×${n}`);
      counts.delete(def.id);
    }
  }
  for (const [key, n] of counts) {
    if (key === '') continue;
    groups.push(`${key} ×${n}`);
  }
  const notSet = counts.get('');
  if (notSet) groups.push(`Not set ×${notSet}`);

  const head = `${s.doneItems}/${s.itemCount} done`;
  let tail = '';
  if (s.lastAt && s.lastBy) {
    const d = parseTimestamp(s.lastAt);
    tail = ` — ${s.lastBy}${d ? `, ${formatMonD(d, s.tz, s.now)}` : ''}`;
  }
  const assemble = (parts: string[], dropped: number) => {
    let body = head;
    if (parts.length > 0) body += ` · ${parts.join(' · ')}`;
    if (dropped > 0) body += ` +${dropped} more`;
    return body + tail;
  };
  let dropped = 0;
  const parts = [...groups];
  let out = assemble(parts, dropped);
  while (out.length > SUMMARY_MAX && parts.length > 0) {
    parts.pop();
    dropped++;
    out = assemble(parts, dropped);
  }
  return out.length > SUMMARY_MAX ? out.slice(0, SUMMARY_MAX) : out;
}
