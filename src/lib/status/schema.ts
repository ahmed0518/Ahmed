import { parseTimestamp } from '@/lib/time';
import {
  createItems,
  type HistoryEntry,
  type HistoryKind,
  type ItemEntry,
  type ItemStatus,
  type Source,
} from './types';

/**
 * `item_status` is untrusted on read (Claude and other tools write it too). This validates
 * the shape described in SPEC §4.1 and returns a clean copy. Unknown fields are dropped,
 * missing optional fields get safe defaults, anything structurally wrong is rejected.
 */

export const LINE_ITEM_ID_RE = /^\d{1,20}$/;
const STATUS_ID_RE = /^[a-z0-9_]{1,60}$/;
const KINDS: readonly HistoryKind[] = ['set', 'confirm', 'clear'];
const SOURCES: readonly Source[] = ['web', 'api', 'claude', 'import'];
const TITLE_MAX = 500;
const NAME_MAX = 60;
const NOTE_MAX = 200;
const MAX_ITEMS = 500;
const MAX_HISTORY = 200;

export type ParseResult =
  | { ok: true; value: ItemStatus | null }
  | { ok: false; reason: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  return v.length > max ? v.slice(0, max) : v;
}

function statusId(v: unknown): string | null | undefined {
  if (v === null) return null;
  if (typeof v !== 'string') return undefined;
  const id = v.trim();
  return STATUS_ID_RE.test(id) ? id : undefined;
}

function parseHistoryEntry(raw: unknown, fallback: { by: string; source: Source; via: string }): HistoryEntry | null {
  if (!isRecord(raw)) return null;
  const kind = raw.kind;
  if (typeof kind !== 'string' || !KINDS.includes(kind as HistoryKind)) return null;
  const status = statusId(raw.status);
  if (status === undefined) return null;
  const at = parseTimestamp(raw.at);
  if (!at) return null;
  const by = str(raw.by, NAME_MAX) ?? fallback.by;
  const source = typeof raw.source === 'string' && SOURCES.includes(raw.source as Source) ? (raw.source as Source) : fallback.source;
  const via = str(raw.via, 80) ?? fallback.via;
  const note = str(raw.note, NOTE_MAX) ?? '';
  return { kind: kind as HistoryKind, status, at: raw.at as string, by, source, via, note };
}

function parseEntry(raw: unknown): ItemEntry | null {
  if (!isRecord(raw)) return null;
  const title = str(raw.title, TITLE_MAX) ?? '';
  const status = statusId(raw.status);
  if (status === undefined) return null;
  const updatedAt = parseTimestamp(raw.updated_at);
  if (!updatedAt) return null;
  const updatedBy = str(raw.updated_by, NAME_MAX);
  if (updatedBy === null) return null;
  const source: Source =
    typeof raw.source === 'string' && SOURCES.includes(raw.source as Source) ? (raw.source as Source) : 'import';
  const via = str(raw.via, 80) ?? updatedBy;
  const history: HistoryEntry[] = [];
  if (raw.history !== undefined) {
    if (!Array.isArray(raw.history)) return null;
    for (const h of raw.history.slice(-MAX_HISTORY)) {
      const parsed = parseHistoryEntry(h, { by: updatedBy, source, via });
      if (!parsed) return null;
      history.push(parsed);
    }
  }
  return { title, status, updated_at: raw.updated_at as string, updated_by: updatedBy, source, via, history };
}

/**
 * @param raw the metafield value (JSON text) or null when the metafield does not exist.
 */
export function parseItemStatus(raw: string | null | undefined): ParseResult {
  if (raw === null || raw === undefined || raw === '') return { ok: true, value: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'not valid JSON' };
  }
  return validateItemStatus(parsed);
}

export function validateItemStatus(parsed: unknown): ParseResult {
  if (!isRecord(parsed)) return { ok: false, reason: 'not an object' };
  if (parsed.v !== 1) return { ok: false, reason: `unknown version ${String(parsed.v)}` };
  if (!isRecord(parsed.items)) return { ok: false, reason: 'items is not an object' };

  const items = createItems();
  const keys = Object.keys(parsed.items);
  if (keys.length > MAX_ITEMS) return { ok: false, reason: 'too many items' };
  for (const key of keys) {
    if (!LINE_ITEM_ID_RE.test(key)) return { ok: false, reason: `bad item key ${key.slice(0, 30)}` };
    const entry = parseEntry(parsed.items[key]);
    if (!entry) return { ok: false, reason: `bad entry for ${key}` };
    items[key] = entry;
  }

  let visibleIds: string[] | undefined;
  if (parsed.visible_ids !== undefined && parsed.visible_ids !== null) {
    if (!Array.isArray(parsed.visible_ids)) return { ok: false, reason: 'visible_ids is not an array' };
    visibleIds = [];
    for (const id of parsed.visible_ids) {
      if (typeof id !== 'string' || !LINE_ITEM_ID_RE.test(id)) return { ok: false, reason: 'bad visible id' };
      if (!visibleIds.includes(id)) visibleIds.push(id);
    }
  }

  const value: ItemStatus = { v: 1, items };
  if (visibleIds) value.visible_ids = visibleIds;
  return { ok: true, value };
}

/** Minified JSON for storage; items are written in insertion order. */
export function serializeItemStatus(status: ItemStatus): string {
  const items: Record<string, ItemEntry> = {};
  for (const key of Object.keys(status.items)) {
    const e = status.items[key];
    if (e) items[key] = e;
  }
  return JSON.stringify({ v: 1, visible_ids: status.visible_ids ?? [], items });
}

/** Deep copy with a null-prototype items object (never mutate what a cache handed out). */
export function cloneItemStatus(status: ItemStatus): ItemStatus {
  const items = createItems();
  for (const key of Object.keys(status.items)) {
    const e = status.items[key];
    if (!e) continue;
    items[key] = { ...e, history: e.history.map((h) => ({ ...h })) };
  }
  const copy: ItemStatus = { v: 1, items };
  if (status.visible_ids) copy.visible_ids = [...status.visible_ids];
  return copy;
}
