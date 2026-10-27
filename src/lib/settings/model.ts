import { parseTimestamp } from '@/lib/time';
import type { Settings, StaffEntry, StaffRoster, StatusDef } from '@/lib/status/types';

/** Defaults (SPEC §4.3) used when a shop metafield is missing or invalid. */
export const DEFAULT_STATUSES: readonly StatusDef[] = [
  { id: 'cad', name: 'CAD' },
  { id: 'assembling', name: 'Assembling' },
  { id: 'mold', name: 'Mold' },
  { id: 'polishing', name: 'Polishing' },
  { id: 'polishing_erik', name: 'Polishing Erik' },
  { id: 'polishing_maria', name: 'Polishing Maria' },
  { id: 'casting', name: 'Casting' },
  { id: 'engraving', name: 'Engraving' },
  { id: 'final_polishing', name: 'Final Polishing' },
  { id: 'cleaning_casting', name: 'Cleaning Casting' },
  { id: 'resizing', name: 'Resizing' },
  { id: 'setting', name: 'Setting' },
  { id: 'setting_azavedo', name: 'Setting Azavedo' },
  { id: 'setting_igor', name: 'Setting Igor' },
  { id: 'setting_jorje', name: 'Setting Jorje' },
  { id: 'waiting_for_dia', name: 'Waiting for DIA', waiting: true },
  { id: 'sent_to_store', name: 'Sent to Store', done: true },
  { id: 'sent_to_shipping_dept', name: 'Sent to Shipping Dept', done: true },
  { id: 'waiting_for_chain', name: 'Waiting for Chain', waiting: true },
];

export const DEFAULT_WATCH_QUERY = 'tag:custom-item-order status:open fulfillment_status:unshipped';

export function defaultSettings(): Settings {
  return {
    v: 1,
    statuses: DEFAULT_STATUSES.map((s) => ({ ...s })),
    stale_after_days: 3,
    work_days: [1, 2, 3, 4, 5],
    hide_items_matching: ['warranty', 'shipping protection'],
    watch_query: DEFAULT_WATCH_QUERY,
    admin_failed_attempts: 0,
    admin_locked_until: null,
  };
}

export function defaultStaff(): StaffRoster {
  return { v: 1, staff: [] };
}

export const STATUS_ID_RE = /^[a-z0-9_]{1,60}$/;
export const STAFF_ID_RE = /^[a-z0-9_]{1,30}$/;
export const STATUS_NAME_MAX = 60;
export const STAFF_NAME_MAX = 30;
export const WATCH_QUERY_MAX = 500;
export const HIDE_PATTERN_MAX = 100;

/** Immutable slug made once from a name: lowercase, `[^a-z0-9]+` → `_`. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isInt(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
}

function optionalBool(v: unknown): boolean | null {
  if (v === undefined) return false;
  return typeof v === 'boolean' ? v : null;
}

/**
 * A stored status or staff name: trimmed, 1–`max` characters, no control characters — a
 * line break would be copied into a single-line order metafield and poison every write.
 */
function validName(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const name = v.trim();
  if (name.length === 0 || name.length > max || /[\x00-\x1f\x7f]/.test(name)) return null;
  return name;
}

export function validateStatuses(raw: unknown): StatusDef[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 200) return null;
  const ids = new Set<string>();
  const names = new Set<string>();
  const out: StatusDef[] = [];
  for (const s of raw) {
    if (!isRecord(s)) return null;
    if (typeof s.id !== 'string' || !STATUS_ID_RE.test(s.id)) return null;
    const name = validName(s.name, STATUS_NAME_MAX);
    if (name === null) return null;
    const done = optionalBool(s.done);
    const waiting = optionalBool(s.waiting);
    const retired = optionalBool(s.retired);
    if (done === null || waiting === null || retired === null) return null;
    if (ids.has(s.id) || names.has(name.toLowerCase())) return null;
    ids.add(s.id);
    names.add(name.toLowerCase());
    const def: StatusDef = { id: s.id, name };
    if (done) def.done = true;
    if (waiting) def.waiting = true;
    if (retired) def.retired = true;
    out.push(def);
  }
  return out;
}

export function validateWorkDays(raw: unknown): number[] | null {
  if (!Array.isArray(raw) || raw.length > 7) return null;
  const out: number[] = [];
  for (const d of raw) {
    if (!isInt(d, 1, 7) || out.includes(d)) return null;
    out.push(d);
  }
  return out.sort((a, b) => a - b);
}

export function validateHidePatterns(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length > 50) return null;
  const out: string[] = [];
  for (const p of raw) {
    if (typeof p !== 'string') return null;
    const t = p.trim();
    if (t.length === 0 || t.length > HIDE_PATTERN_MAX) return null;
    out.push(t);
  }
  return out;
}

function validateLockFields(raw: Record<string, unknown>, attemptsKey: string, untilKey: string): { attempts: number; until: string | null } | null {
  const attempts = raw[attemptsKey] === undefined ? 0 : raw[attemptsKey];
  if (!isInt(attempts, 0, 1_000_000)) return null;
  const until = raw[untilKey] === undefined ? null : raw[untilKey];
  if (until !== null && !parseTimestamp(until)) return null;
  return { attempts, until: until as string | null };
}

/** Returns a clean Settings or null when the stored value is invalid (caller logs and uses defaults). */
export function validateSettings(raw: unknown): Settings | null {
  if (!isRecord(raw) || raw.v !== 1) return null;
  const statuses = validateStatuses(raw.statuses);
  if (!statuses) return null;
  if (!isInt(raw.stale_after_days, 0, 365)) return null;
  const workDays = validateWorkDays(raw.work_days);
  if (!workDays) return null;
  const hide = validateHidePatterns(raw.hide_items_matching);
  if (!hide) return null;
  if (typeof raw.watch_query !== 'string' || raw.watch_query.length > WATCH_QUERY_MAX) return null;
  const lock = validateLockFields(raw, 'admin_failed_attempts', 'admin_locked_until');
  if (!lock) return null;
  return {
    v: 1,
    statuses,
    stale_after_days: raw.stale_after_days,
    work_days: workDays,
    hide_items_matching: hide,
    watch_query: raw.watch_query.trim(),
    admin_failed_attempts: lock.attempts,
    admin_locked_until: lock.until,
  };
}

export function validateStaff(raw: unknown): StaffRoster | null {
  if (!isRecord(raw) || raw.v !== 1 || !Array.isArray(raw.staff) || raw.staff.length > 200) return null;
  const ids = new Set<string>();
  const names = new Set<string>();
  const out: StaffEntry[] = [];
  for (const s of raw.staff) {
    if (!isRecord(s)) return null;
    if (typeof s.id !== 'string' || !STAFF_ID_RE.test(s.id)) return null;
    const name = validName(s.name, STAFF_NAME_MAX);
    if (name === null) return null;
    const pinHash = s.pin_hash === undefined ? null : s.pin_hash;
    if (pinHash !== null && (typeof pinHash !== 'string' || !/^[0-9a-f]{64}$/.test(pinHash))) return null;
    if (typeof s.active !== 'boolean') return null;
    const sv = s.session_version === undefined ? 1 : s.session_version;
    if (!isInt(sv, 1, 1_000_000_000)) return null;
    const lock = validateLockFields(s, 'failed_attempts', 'locked_until');
    if (!lock) return null;
    if (ids.has(s.id) || names.has(name.toLowerCase())) return null;
    ids.add(s.id);
    names.add(name.toLowerCase());
    out.push({
      id: s.id,
      name,
      pin_hash: pinHash,
      active: s.active,
      session_version: sv,
      failed_attempts: lock.attempts,
      locked_until: lock.until,
    });
  }
  return { v: 1, staff: out };
}

/** Status by id or by name (case-insensitive, trimmed). */
export function resolveStatus(settings: Pick<Settings, 'statuses'>, input: string): StatusDef | null {
  const needle = input.trim();
  if (!needle) return null;
  const lower = needle.toLowerCase();
  return (
    settings.statuses.find((s) => s.id === lower) ??
    settings.statuses.find((s) => s.name.toLowerCase() === lower) ??
    null
  );
}

/** What /api/statuses and the admin page may expose about statuses. */
export function publicStatuses(settings: Settings): { id: string; name: string; done: boolean; waiting: boolean; retired: boolean }[] {
  return settings.statuses.map((s) => ({
    id: s.id,
    name: s.name,
    done: Boolean(s.done),
    waiting: Boolean(s.waiting),
    retired: Boolean(s.retired),
  }));
}
