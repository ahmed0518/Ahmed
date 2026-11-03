/**
 * The inventory routes' shared logic (SPEC §14.8): who is asking, what they may see, and the
 * one payload shape the page and `GET /api/inventory` both render.
 */
import { randomBytes } from 'node:crypto';
import { isAdmin, readCredential } from '@/lib/auth/credential';
import type { HeaderReader } from '@/lib/auth/csrf';
import { badRequest, forbidden, notFound, unauthorized } from '@/lib/errors';
import { formatTimestamp } from '@/lib/time';
import { actorName, resolveViewer, type Viewer } from './access';
import { sortSlips, tiles, type Tiles } from './compute';
import { SLIP_KINDS, isSlipKind, validateSlipInput, type InventorySettings, type Slip, type SlipKind, type SyncStamp } from './model';
import { scanEnabled } from './scan';
import { getInventoryStore } from './store';

export interface InventoryPayload {
  viewer: { name: string; owner: boolean; can_write: boolean; sections: SlipKind[] };
  today: string;
  scan_enabled: boolean;
  settings: { jewelers: string[]; scrap_since: string; last_sync: Partial<Record<string, SyncStamp>> };
  tiles: Tiles;
  slips: Slip[];
}

/** YYYY-MM-DD in the display time zone — "today" for the slips, the tiles and the missing-slip line. */
export function todayIn(tz: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Credential + settings → viewer. Anonymous callers get 401 from the API (the page redirects to /login instead). */
export async function viewerFor(headers: HeaderReader): Promise<{ viewer: Viewer; settings: InventorySettings }> {
  const store = getInventoryStore();
  const settings = await store.getSettings();
  const cred = await readCredential(headers);
  return { viewer: resolveViewer(cred, isAdmin(headers), settings), settings };
}

export async function requireViewer(headers: HeaderReader): Promise<{ viewer: Viewer; settings: InventorySettings }> {
  const res = await viewerFor(headers);
  if (res.viewer.kind === 'anonymous') throw unauthorized();
  return res;
}

export function requireSection(viewer: Viewer, kind: SlipKind): void {
  if (!viewer.sections.includes(kind)) throw forbidden('section_not_allowed');
}

export function requireWrite(viewer: Viewer): void {
  if (!viewer.canWrite) throw forbidden('read_only');
}

export async function buildPayload(viewer: Viewer, settings: InventorySettings, tz: string, kind?: SlipKind): Promise<InventoryPayload> {
  const store = getInventoryStore();
  const all = await store.listSlips();
  const visible = sortSlips(all.filter((s) => viewer.sections.includes(s.kind) && (!kind || s.kind === kind)));
  const today = todayIn(tz);
  return {
    viewer: { name: viewer.name, owner: viewer.owner, can_write: viewer.canWrite, sections: viewer.sections },
    today,
    scan_enabled: scanEnabled(),
    settings: { jewelers: settings.jewelers, scrap_since: settings.scrap_since, last_sync: settings.last_sync },
    tiles: tiles(all.filter((s) => viewer.sections.includes(s.kind)), today, settings.scrap_since),
    slips: visible,
  };
}

export function parseKindParam(raw: string | null): SlipKind | undefined {
  if (raw === null || raw === '') return undefined;
  if (!isSlipKind(raw)) throw badRequest('invalid_kind', `kind must be one of ${SLIP_KINDS.join(', ')}`);
  return raw;
}

export function newSlipId(now: Date = new Date()): string {
  return `${formatTimestamp(now).slice(0, 10)}-${randomBytes(6).toString('hex')}`;
}

/** Validate, stamp and store a slip from the review form or an agent. */
export async function createSlip(viewer: Viewer, body: unknown): Promise<Slip> {
  requireWrite(viewer);
  const input = validateSlipInput(body);
  if (!input.ok) throw badRequest('invalid_slip', input.error);
  requireSection(viewer, input.value.kind);
  const source = input.value.source === 'monday' ? 'manual' : input.value.source; // only the sync writes monday rows
  const slip = { ...input.value, source, id: newSlipId(), createdAt: formatTimestamp(new Date()), createdBy: actorName(viewer) } as Slip;
  await getInventoryStore().putSlips([slip]);
  return slip;
}

export async function deleteSlip(viewer: Viewer, id: string): Promise<void> {
  requireWrite(viewer);
  const store = getInventoryStore();
  const slip = await store.getSlip(id);
  if (!slip) throw notFound('slip_not_found', 'No such slip');
  requireSection(viewer, slip.kind);
  await store.deleteSlip(id);
}
