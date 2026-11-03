/**
 * monday.com → slips (SPEC §14.7). Four boards in the TRAX NYC workspace feed the sections.
 * One record per board row-day, upserted by a stable id — never appended twice. The mappers
 * are pure (tested on captured rows); `syncMonday` fetches, maps, writes and stamps
 * `settings.last_sync`.
 */
import { getEnv } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { log } from '@/lib/log';
import { formatTimestamp } from '@/lib/time';
import { karatKey, normalizeName, nameKey, numberCell, slug, validateSlip, type CastingLine, type CastingSlip, type MetalSlip, type ScrapLine, type Slip, type SyncBoard, type SyncStamp } from './model';
import type { InventoryStore } from './store-shared';

export const BOARD_IDS: Record<SyncBoard, string> = {
  diamond: '18437692268',
  casting: '18436449049',
  scrap: '9445344009',
  dust: '9504626073',
};

export interface MondayColumn {
  id: string;
  text: string | null;
  value?: string | null;
}
export interface MondayItem {
  id: string;
  name: string;
  group: { id: string; title: string } | null;
  column_values: MondayColumn[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}/;

function col(item: MondayItem, id: string): string {
  return (item.column_values.find((c) => c.id === id)?.text ?? '').trim();
}
function numCol(item: MondayItem, id: string): number | null {
  const n = numberCell(col(item, id).replace(/[$,\s]/g, ''));
  return n === undefined ? null : n;
}
function dateCol(item: MondayItem, id: string): string | null {
  const t = col(item, id);
  return DATE_RE.test(t) ? t.slice(0, 10) : null;
}

/** A mapper's output is validated like any other write; a row that fails validation is dropped and reported. */
function finish(docs: Record<string, unknown>[], board: SyncBoard): { slips: Slip[]; dropped: number } {
  const slips: Slip[] = [];
  let dropped = 0;
  for (const d of docs) {
    const s = validateSlip(d);
    if (s) slips.push(s);
    else {
      dropped++;
      log.warn('monday row did not validate', { board, id: String(d.id ?? '') });
    }
  }
  return { slips, dropped };
}

export interface MapContext {
  /** slips already in the store (for the dust skip rule and the casting date) */
  existing: readonly Slip[];
  /** YYYY-MM-DD */
  today: string;
  /** ISO timestamp for `createdAt` */
  now: string;
  /** scrap rows before this day are history only and are not written */
  scrapSince: string;
}

// ---------- Gold Dust-Jalgas (9504626073) ----------
export const DUST_COLS = { person: 'text_mksf70b5', grams: 'numeric_mkvyfksc', date: 'date4' } as const;
export const DUST_GROUP = 'July 2025-Present';
const DUST_NOTE = 'Dust from the Gold Dust-Jalgas board on monday.com. Date is the day Jalgas logged it (usually the next business day after the slip).';
const REFINERY_NOTE = 'Dust from the Gold Dust-Jalgas board. Eric’s dust is what goes to the refinery every 2–3 months — a refinery lot, not bench dust.';
/** rows this heavy are refinery lots, whoever is named */
export const REFINERY_GRAMS = 100;

function daysBetween(a: string, b: string): number {
  return Math.round((Date.UTC(Number(b.slice(0, 4)), Number(b.slice(5, 7)) - 1, Number(b.slice(8, 10))) - Date.UTC(Number(a.slice(0, 4)), Number(a.slice(5, 7)) - 1, Number(a.slice(8, 10)))) / 86_400_000);
}

/**
 * One slip per person-day from the "July 2025-Present" group. Skipped when a scanned slip of
 * the same person already carries that dust (same grams, dated the same day or up to three
 * calendar days earlier — Jalgas types the board the next business day).
 */
export function mapDustRows(items: readonly MondayItem[], ctx: MapContext): { slips: Slip[]; dropped: number; skipped: number } {
  const scanned = ctx.existing.filter((s): s is MetalSlip => s.kind === 'metal' && s.source !== 'monday' && s.dust !== null);
  const docs: Record<string, unknown>[] = [];
  let skipped = 0;
  for (const item of items) {
    if ((item.group?.title ?? '').trim() !== DUST_GROUP) continue;
    const who = normalizeName(col(item, DUST_COLS.person) || item.name);
    const grams = numCol(item, DUST_COLS.grams);
    const date = dateCol(item, DUST_COLS.date);
    if (!who || grams === null || !date) {
      skipped++;
      continue;
    }
    const dup = scanned.some((s) => nameKey(s.who) === nameKey(who) && Math.abs((s.dust ?? 0) - grams) < 0.005 && daysBetween(s.date, date) >= 0 && daysBetween(s.date, date) <= 3);
    if (dup) {
      skipped++;
      continue;
    }
    const refinery = grams >= REFINERY_GRAMS || nameKey(who) === 'eric';
    docs.push({ id: `dust-${slug(who)}-${date}`, kind: 'metal', who, date, dust: grams, lines: [], note: refinery ? REFINERY_NOTE : DUST_NOTE, source: 'monday', createdAt: ctx.now });
  }
  const merged = new Map<string, Record<string, unknown>>();
  for (const d of docs) {
    const prev = merged.get(d.id as string);
    if (prev) prev.dust = Math.round(((prev.dust as number) + (d.dust as number)) * 1000) / 1000; // two rows for one person-day add up
    else merged.set(d.id as string, d);
  }
  return { ...finish([...merged.values()], 'dust'), skipped };
}

// ---------- [JIN] - DIAMOND INVENTORY (18437692268) ----------
export const DIAMOND_COLS = { size: 'numeric_mm8kgnn4', carats: 'numeric_mm8k5dej', price: 'numeric_mm8kcvkk', counted: 'date_mm8k1yj9', note: 'text_mm8kvnda' } as const;
const DIAMOND_NOTE = 'Pulled from the monday.com board [JIN] - DIAMOND INVENTORY (Mr. Jin updates it there). Date = latest "Last counted" on the board for this grade.';

/** One slip per grade (= board group): every size row, dated by the latest "Last counted" in the group. */
export function mapDiamondRows(items: readonly MondayItem[], ctx: MapContext): { slips: Slip[]; dropped: number; skipped: number } {
  const groups = new Map<string, { quality: string; lines: Record<string, unknown>[]; date: string; notes: string[] }>();
  let skipped = 0;
  for (const item of items) {
    const quality = (item.group?.title ?? '').trim();
    if (!quality) {
      skipped++;
      continue;
    }
    const size = numCol(item, DIAMOND_COLS.size) ?? (numberCell(item.name.replace(/[^\d.]/g, '')) || null);
    const carats = numCol(item, DIAMOND_COLS.carats);
    if (carats === null) {
      skipped++;
      continue;
    }
    const g = groups.get(quality) ?? { quality, lines: [], date: '', notes: [] };
    g.lines.push({ quality, size, carats, price: numCol(item, DIAMOND_COLS.price) });
    const counted = dateCol(item, DIAMOND_COLS.counted);
    if (counted && counted > g.date) g.date = counted;
    const note = col(item, DIAMOND_COLS.note);
    if (note) g.notes.push(`${size ?? item.name} mm: ${note}`);
    groups.set(quality, g);
  }
  const docs: Record<string, unknown>[] = [];
  for (const g of groups.values()) {
    g.lines.sort((a, b) => ((a.size as number | null) ?? 999) - ((b.size as number | null) ?? 999));
    const note = [DIAMOND_NOTE, ...g.notes].join(' ').slice(0, 1000);
    docs.push({ id: `diamond-${slug(g.quality)}-monday`, kind: 'diamond', who: 'Mr. Jin', date: g.date || ctx.today, lines: g.lines, note, source: 'monday', createdAt: ctx.now });
  }
  return { ...finish(docs, 'diamond'), skipped };
}

// ---------- CASTING INVENTORY (18436449049) ----------
export const CASTING_COLS = { type: 'text_mm8bv4n2', yellow: 'numeric_mm8bbm9f', white: 'numeric_mm8bwfjz', rose: 'numeric_mm8bb2t8', total: 'numeric_mm8b2arz', weight: 'numeric_mm8b3btx', karat: 'color_mm8bewgb', price: 'numeric_mm8bnk1w' } as const;
export const CASTING_ID = 'casting-monday';
const CASTING_NOTE = 'Pulled from the monday.com CASTING INVENTORY board. Value = pieces x g/pc x $/g from the board.';

/**
 * The whole board is one count. Its slip keeps a stable id; the date moves to today only when
 * a line changed since the last sync, so an untouched board does not look freshly counted.
 */
export function mapCastingRows(items: readonly MondayItem[], ctx: MapContext): { slips: Slip[]; dropped: number; skipped: number } {
  const lines: CastingLine[] = [];
  let skipped = 0;
  for (const item of items) {
    const line: CastingLine = {
      type: col(item, CASTING_COLS.type).slice(0, 120),
      item: item.name.trim().slice(0, 120),
      karat: karatKey(col(item, CASTING_COLS.karat)) === 'Unlabeled' ? '' : karatKey(col(item, CASTING_COLS.karat)),
      yellow: numCol(item, CASTING_COLS.yellow),
      white: numCol(item, CASTING_COLS.white),
      rose: numCol(item, CASTING_COLS.rose),
      weight: numCol(item, CASTING_COLS.weight),
      price: numCol(item, CASTING_COLS.price),
    };
    if (!line.item || (line.yellow === null && line.white === null && line.rose === null)) {
      skipped++;
      continue;
    }
    lines.push(line);
  }
  if (lines.length === 0) return { slips: [], dropped: 0, skipped };
  const previous = ctx.existing.find((s): s is CastingSlip => s.kind === 'casting' && s.id === CASTING_ID);
  const unchanged = previous !== undefined && JSON.stringify(previous.lines) === JSON.stringify(lines);
  const date = unchanged ? previous.date : ctx.today;
  return { ...finish([{ id: CASTING_ID, kind: 'casting', who: 'Rina', date, lines, note: CASTING_NOTE, source: 'monday', createdAt: unchanged ? previous.createdAt : ctx.now }], 'casting'), skipped };
}

// ---------- [JALGAS] - SCRAP GOLD TRACKING (9445344009) ----------
export const SCRAP_COLS = { date: 'date4', karat: 'text_mks7vz98', grams: 'numeric_mks8kca8', value: 'numeric_mks82dvc', order: 'text_mks74ast', person: 'text_mksfg2ra' } as const;
export const SCRAP_GROUPS = { in: 'Scrapping', out: 'Outgoing Scrap' } as const;
/** a "$" this large is an order number typed into the cost column (the Oct 6 2025 row) */
export const SCRAP_VALUE_MAX = 50_000;
const SCRAP_IN_NOTE = 'Scrapped pieces from the monday.com scrap board.';
const SCRAP_OUT_NOTE = 'Given out, from the monday.com scrap board (Outgoing Scrap).';

/**
 * Scrapping → one `in` slip per day; Outgoing Scrap → one `out` slip per day and receiver.
 * On Hold / Incoming are not ledger movements. Rows before `scrapSince` are not written.
 */
export function mapScrapRows(items: readonly MondayItem[], ctx: MapContext): { slips: Slip[]; dropped: number; skipped: number } {
  const slips = new Map<string, Record<string, unknown> & { lines: ScrapLine[]; notes: string[] }>();
  let skipped = 0;
  for (const item of items) {
    const group = (item.group?.title ?? '').trim();
    const dir = group === SCRAP_GROUPS.in ? 'in' : group === SCRAP_GROUPS.out ? 'out' : null;
    const date = dateCol(item, SCRAP_COLS.date);
    const grams = numCol(item, SCRAP_COLS.grams);
    if (!dir || !date || grams === null || date < ctx.scrapSince) {
      skipped++;
      continue;
    }
    const order = col(item, SCRAP_COLS.order);
    const person = normalizeName(col(item, SCRAP_COLS.person));
    let value = numCol(item, SCRAP_COLS.value);
    const notes: string[] = [];
    if (value !== null && value > SCRAP_VALUE_MAX) {
      notes.push(`${item.name}: the $ column holds ${value} — looks like an order number, left blank.`);
      value = null;
    }
    const what = order && !item.name.includes(order) ? `${order}-${item.name.trim()}` : item.name.trim();
    const to = dir === 'out' ? person || (order ? `Order ${order}` : 'Unknown') : '';
    const id = dir === 'in' ? `scrap-in-${date}` : `scrap-out-${date}-${slug(to) || 'unknown'}`;
    const s = slips.get(id) ?? { id, kind: 'scrap', who: 'Jalgas', date, dir, to, lines: [], note: dir === 'in' ? SCRAP_IN_NOTE : SCRAP_OUT_NOTE, source: 'monday', createdAt: ctx.now, notes: [] };
    s.lines.push({ what: what.slice(0, 120), karat: karatKey(col(item, SCRAP_COLS.karat)) === 'Unlabeled' ? '' : karatKey(col(item, SCRAP_COLS.karat)), grams, value });
    s.notes.push(...notes);
    slips.set(id, s);
  }
  const docs = [...slips.values()].map(({ notes, ...s }) => ({ ...s, note: [s.note as string, ...notes].join(' ').slice(0, 1000) }));
  return { ...finish(docs, 'scrap'), skipped };
}

export const MAPPERS: Record<SyncBoard, (items: readonly MondayItem[], ctx: MapContext) => { slips: Slip[]; dropped: number; skipped: number }> = {
  dust: mapDustRows,
  diamond: mapDiamondRows,
  casting: mapCastingRows,
  scrap: mapScrapRows,
};

// ---------- fetching ----------
const ITEM_FIELDS = 'id name group { id title } column_values { id text }';
const FIRST_PAGE = `query ($board: ID!) { boards(ids: [$board]) { items_page(limit: 200) { cursor items { ${ITEM_FIELDS} } } } }`;
const NEXT_PAGE = `query ($cursor: String!) { next_items_page(limit: 200, cursor: $cursor) { cursor items { ${ITEM_FIELDS} } } }`;
const MAX_PAGES = 50;

export class MondayError extends AppError {
  constructor(detail: string) {
    super(502, 'monday_error', 'monday.com request failed', { detail });
    this.name = 'MondayError';
  }
}

interface Page {
  cursor: string | null;
  items: MondayItem[];
}

async function mondayGraphQL<T>(query: string, variables: Record<string, unknown>, fetchImpl: typeof fetch): Promise<T> {
  const env = getEnv();
  if (!env.MONDAY_API_TOKEN) throw new AppError(503, 'sync_unavailable', 'The monday.com sync is not set up on this server (MONDAY_API_TOKEN).');
  let last = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    let res: Response;
    try {
      res = await fetchImpl(env.MONDAY_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: env.MONDAY_API_TOKEN, 'API-Version': '2024-10' },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      last = `HTTP ${res.status}`;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      continue;
    }
    const body = (await res.json().catch(() => null)) as { data?: T; errors?: { message: string }[]; error_message?: string } | null;
    if (!res.ok || !body) throw new MondayError(`HTTP ${res.status}`);
    if (body.errors?.length || body.error_message) throw new MondayError(body.errors?.map((e) => e.message).join('; ') ?? body.error_message ?? 'error');
    if (!body.data) throw new MondayError('no data');
    return body.data;
  }
  throw new MondayError(`gave up: ${last}`);
}

/** Every item of a board (200 per page, at most 50 pages). */
export async function fetchBoardItems(boardId: string, fetchImpl: typeof fetch = fetch): Promise<MondayItem[]> {
  const first = await mondayGraphQL<{ boards: { items_page: Page }[] }>(FIRST_PAGE, { board: boardId }, fetchImpl);
  const page = first.boards[0]?.items_page;
  if (!page) throw new MondayError(`board ${boardId} not found or not shared with the token`);
  const items = [...page.items];
  let cursor = page.cursor;
  for (let n = 0; cursor && n < MAX_PAGES; n++) {
    const next = await mondayGraphQL<{ next_items_page: Page }>(NEXT_PAGE, { cursor }, fetchImpl);
    items.push(...next.next_items_page.items);
    cursor = next.next_items_page.cursor;
  }
  return items;
}

export interface SyncResult {
  board: SyncBoard;
  ok: boolean;
  fetched: number;
  written: number;
  skipped: number;
  dropped: number;
  error?: string;
}

export interface SyncDeps {
  fetchImpl?: typeof fetch;
  now?: Date;
}

/** Sync the given boards (default: all four), write the slips, stamp `last_sync`. Never throws for one board's failure. */
export async function syncMonday(store: InventoryStore, boards: readonly SyncBoard[], deps: SyncDeps = {}): Promise<SyncResult[]> {
  const now = deps.now ?? new Date();
  const fetchImpl = deps.fetchImpl ?? fetch;
  const results: SyncResult[] = [];
  const settings = await store.getSettings();
  const existing = await store.listSlips();
  const ctx: MapContext = { existing, today: formatTimestamp(now).slice(0, 10), now: formatTimestamp(now), scrapSince: settings.scrap_since };
  for (const board of boards) {
    const result: SyncResult = { board, ok: false, fetched: 0, written: 0, skipped: 0, dropped: 0 };
    try {
      const items = await fetchBoardItems(BOARD_IDS[board], fetchImpl);
      result.fetched = items.length;
      const mapped = MAPPERS[board](items, ctx);
      await store.putSlips(mapped.slips);
      result.written = mapped.slips.length;
      result.skipped = mapped.skipped;
      result.dropped = mapped.dropped;
      result.ok = true;
      log.info('monday sync', { ...result });
    } catch (e) {
      result.error = e instanceof AppError ? (e.detail ?? e.message) : e instanceof Error ? e.message : String(e);
      log.error('monday sync failed', { board, detail: result.error });
    }
    const stamp: SyncStamp = { at: formatTimestamp(now), ok: result.ok, count: result.written, ...(result.error ? { error: result.error.slice(0, 300) } : {}) };
    await store.updateSettings((s) => ({ ...s, last_sync: { ...s.last_sync, [board]: stamp } }));
    results.push(result);
  }
  return results;
}

