import { cleanText, utf8Length } from '@/lib/text';
import { formatTimestamp } from '@/lib/time';
import { cloneItemStatus, serializeItemStatus } from './schema';
import {
  HISTORY_CAP,
  ITEM_STATUS_MAX_BYTES,
  NOTE_MAX,
  emptyItemStatus,
  type Actor,
  type Change,
  type HistoryKind,
  type ItemStatus,
} from './types';

export { cleanText };

export interface ApplyResult {
  next: ItemStatus;
  kinds: Record<string, HistoryKind>;
}

/**
 * Apply status changes (SPEC §4.1):
 * - same status as the current one → `confirm` ("still here")
 * - `null` → `clear` (entry kept, status null)
 * - anything else → `set`
 * History is append-only, oldest first, capped at 30 entries per item.
 */
export function applyChanges(
  current: ItemStatus | null,
  changes: readonly Change[],
  actor: Actor,
  titles: ReadonlyMap<string, string>,
  now: Date,
): ApplyResult {
  const next = current ? cloneItemStatus(current) : emptyItemStatus();
  const at = formatTimestamp(now);
  const kinds: Record<string, HistoryKind> = {};
  for (const change of changes) {
    const existing = next.items[change.lineItemId];
    const title = titles.get(change.lineItemId) ?? existing?.title ?? '';
    let kind: HistoryKind;
    if (existing && existing.status === change.status) kind = 'confirm';
    else if (change.status === null) kind = 'clear';
    else kind = 'set';
    const note = cleanText(change.note ?? '', NOTE_MAX);
    const history = existing ? [...existing.history] : [];
    history.push({ kind, status: change.status, at, by: actor.by, source: actor.source, via: actor.via, note });
    while (history.length > HISTORY_CAP) history.shift();
    next.items[change.lineItemId] = {
      title,
      status: change.status,
      updated_at: at,
      updated_by: actor.by,
      source: actor.source,
      via: actor.via,
      history,
    };
    kinds[change.lineItemId] = kind;
  }
  return { next, kinds };
}

/**
 * Size guard: drop the oldest history entries round-robin across items until the minified
 * JSON fits in `maxBytes`. Returns null when it cannot fit even with empty histories.
 */
export function trimToSize(status: ItemStatus, maxBytes: number = ITEM_STATUS_MAX_BYTES): ItemStatus | null {
  const size = (s: ItemStatus) => utf8Length(serializeItemStatus(s));
  if (size(status) <= maxBytes) return status;
  const next = cloneItemStatus(status);
  const keys = Object.keys(next.items);
  for (;;) {
    let removedAny = false;
    for (const key of keys) {
      const entry = next.items[key];
      if (!entry || entry.history.length === 0) continue;
      entry.history.shift();
      removedAny = true;
      if (size(next) <= maxBytes) return next;
    }
    if (!removedAny) return null;
  }
}
