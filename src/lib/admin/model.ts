import { badRequest } from '@/lib/errors';
import {
  HIDE_PATTERN_MAX,
  STATUS_ID_RE,
  STATUS_NAME_MAX,
  STAFF_NAME_MAX,
  WATCH_QUERY_MAX,
  slugify,
  validateWorkDays,
} from '@/lib/settings/model';
import type { Settings, StaffEntry, StaffRoster, StatusDef } from '@/lib/status/types';

/** What /admin renders and the admin endpoints accept. Never includes pin_hash or lock internals. */

export interface StaffView {
  id: string;
  name: string;
  active: boolean;
  pin_set: boolean;
  locked: boolean;
}

export function staffView(roster: StaffRoster, now: Date = new Date()): StaffView[] {
  return roster.staff.map((s) => ({
    id: s.id,
    name: s.name,
    active: s.active,
    pin_set: s.pin_hash !== null,
    locked: s.locked_until !== null && new Date(s.locked_until).getTime() > now.getTime(),
  }));
}

export interface SettingsForm {
  statuses: { id: string | null; name: string; done: boolean; waiting: boolean; retired: boolean }[];
  stale_after_days: number;
  work_days: number[];
  hide_items_matching: string[];
  watch_query: string;
}

export function settingsForm(s: Settings): SettingsForm {
  return {
    statuses: s.statuses.map((d) => ({ id: d.id, name: d.name, done: Boolean(d.done), waiting: Boolean(d.waiting), retired: Boolean(d.retired) })),
    stale_after_days: s.stale_after_days,
    work_days: [...s.work_days],
    hide_items_matching: [...s.hide_items_matching],
    watch_query: s.watch_query,
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Apply a settings form to the current settings: ids are immutable, existing statuses are
 * never deleted, new ones get a slug made once from the name.
 */
export function applySettingsForm(current: Settings, body: unknown): Settings {
  if (!isRecord(body)) throw badRequest('invalid_settings', 'Body must be an object');
  if (!Array.isArray(body.statuses) || body.statuses.length === 0) throw badRequest('invalid_settings', 'At least one status is required');

  const existing = new Map(current.statuses.map((s) => [s.id, s]));
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  const statuses: StatusDef[] = [];
  for (const raw of body.statuses) {
    if (!isRecord(raw) || typeof raw.name !== 'string') throw badRequest('invalid_settings', 'Each status needs a name');
    const name = raw.name.trim();
    if (name.length === 0 || name.length > STATUS_NAME_MAX) throw badRequest('invalid_settings', `Status names must be 1–${STATUS_NAME_MAX} characters`);
    let id: string;
    if (typeof raw.id === 'string' && raw.id.length > 0) {
      if (!existing.has(raw.id)) throw badRequest('invalid_settings', `Unknown status id "${raw.id.slice(0, 60)}"`);
      id = raw.id;
    } else {
      id = slugify(name);
      if (!STATUS_ID_RE.test(id)) throw badRequest('invalid_settings', `Cannot make an id from "${name}"`);
      if (existing.has(id)) throw badRequest('invalid_settings', `A status with id "${id}" already exists`);
    }
    if (seenIds.has(id)) throw badRequest('invalid_settings', `Status "${id}" is listed twice`);
    if (seenNames.has(name.toLowerCase())) throw badRequest('invalid_settings', `Status name "${name}" is used twice`);
    seenIds.add(id);
    seenNames.add(name.toLowerCase());
    const def: StatusDef = { id, name };
    if (raw.done === true) def.done = true;
    if (raw.waiting === true) def.waiting = true;
    if (raw.retired === true) def.retired = true;
    statuses.push(def);
  }
  for (const id of existing.keys()) {
    if (!seenIds.has(id)) throw badRequest('invalid_settings', `Status "${id}" cannot be deleted — retire it instead`);
  }

  const staleDays = body.stale_after_days;
  if (typeof staleDays !== 'number' || !Number.isInteger(staleDays) || staleDays < 0 || staleDays > 365) {
    throw badRequest('invalid_settings', 'Stale after days must be a whole number between 0 and 365');
  }
  const workDays = validateWorkDays(body.work_days);
  if (!workDays || workDays.length === 0) throw badRequest('invalid_settings', 'Pick at least one work day');

  if (!Array.isArray(body.hide_items_matching)) throw badRequest('invalid_settings', 'Hide patterns must be a list');
  const hide: string[] = [];
  for (const p of body.hide_items_matching) {
    if (typeof p !== 'string') throw badRequest('invalid_settings', 'Hide patterns must be text');
    const t = p.trim();
    if (!t) continue;
    if (t.length > HIDE_PATTERN_MAX) throw badRequest('invalid_settings', `Hide patterns must be at most ${HIDE_PATTERN_MAX} characters`);
    hide.push(t);
  }
  if (hide.length > 50) throw badRequest('invalid_settings', 'At most 50 hide patterns');

  if (typeof body.watch_query !== 'string' || body.watch_query.length > WATCH_QUERY_MAX) {
    throw badRequest('invalid_settings', `Watch query must be text of at most ${WATCH_QUERY_MAX} characters`);
  }

  return {
    ...current,
    statuses,
    stale_after_days: staleDays,
    work_days: workDays,
    hide_items_matching: hide,
    watch_query: body.watch_query.trim(),
  };
}

export type StaffAction =
  | { action: 'add'; name: string; pin: string; active: boolean }
  | { action: 'set_pin'; id: string; pin: string }
  | { action: 'rename'; id: string; name: string }
  | { action: 'deactivate'; id: string }
  | { action: 'activate'; id: string }
  | { action: 'clear_lock'; id: string };

const PIN_RE = /^\d{4,8}$/;

function nameField(v: unknown): string {
  if (typeof v !== 'string') throw badRequest('invalid_staff', 'Name is required');
  const name = v.trim();
  if (name.length === 0 || name.length > STAFF_NAME_MAX) throw badRequest('invalid_staff', `Name must be 1–${STAFF_NAME_MAX} characters`);
  return name;
}

function pinField(v: unknown): string {
  if (typeof v !== 'string' || !PIN_RE.test(v)) throw badRequest('invalid_staff', 'PIN must be 4–8 digits');
  return v;
}

function idField(v: unknown): string {
  if (typeof v !== 'string' || v.length === 0 || v.length > 30) throw badRequest('invalid_staff', 'Staff id is required');
  return v;
}

export function parseStaffAction(body: unknown): StaffAction {
  if (!isRecord(body)) throw badRequest('invalid_staff', 'Body must be an object');
  switch (body.action) {
    case 'add':
      return { action: 'add', name: nameField(body.name), pin: pinField(body.pin), active: body.active !== false };
    case 'set_pin':
      return { action: 'set_pin', id: idField(body.id), pin: pinField(body.pin) };
    case 'rename':
      return { action: 'rename', id: idField(body.id), name: nameField(body.name) };
    case 'deactivate':
    case 'activate':
    case 'clear_lock':
      return { action: body.action, id: idField(body.id) };
    default:
      throw badRequest('invalid_staff', 'Unknown action');
  }
}

/** Pure roster transition; `hash` makes the pin hash for a staff id. */
export function applyStaffAction(current: StaffRoster, action: StaffAction, hash: (id: string, pin: string) => string): StaffRoster {
  const staff = current.staff.map((s) => ({ ...s }));
  const find = (id: string): StaffEntry => {
    const e = staff.find((s) => s.id === id);
    if (!e) throw badRequest('invalid_staff', 'Unknown staff member');
    return e;
  };
  const nameTaken = (name: string, exceptId?: string) => staff.some((s) => s.id !== exceptId && s.name.toLowerCase() === name.toLowerCase());

  switch (action.action) {
    case 'add': {
      const id = slugify(action.name);
      if (!/^[a-z0-9_]{1,30}$/.test(id)) throw badRequest('invalid_staff', `Cannot make an id from "${action.name}"`);
      if (staff.some((s) => s.id === id)) throw badRequest('invalid_staff', `"${action.name}" already exists`);
      if (nameTaken(action.name)) throw badRequest('invalid_staff', `"${action.name}" already exists`);
      staff.push({
        id,
        name: action.name,
        pin_hash: hash(id, action.pin),
        active: action.active,
        session_version: 1,
        failed_attempts: 0,
        locked_until: null,
      });
      break;
    }
    case 'set_pin': {
      const e = find(action.id);
      e.pin_hash = hash(e.id, action.pin);
      e.session_version += 1;
      e.failed_attempts = 0;
      e.locked_until = null;
      break;
    }
    case 'rename': {
      const e = find(action.id);
      if (nameTaken(action.name, e.id)) throw badRequest('invalid_staff', `"${action.name}" already exists`);
      e.name = action.name;
      break;
    }
    case 'deactivate': {
      const e = find(action.id);
      e.active = false;
      e.session_version += 1;
      break;
    }
    case 'activate': {
      find(action.id).active = true;
      break;
    }
    case 'clear_lock': {
      const e = find(action.id);
      e.failed_attempts = 0;
      e.locked_until = null;
      break;
    }
  }
  return { v: 1, staff };
}
