/**
 * Inventory slips (SPEC §14): the four sections of the TRAX inventory page as plain data.
 * Pure and browser-safe — the page, the API and the monday.com sync all validate through
 * here. Numbers are `null` when a cell is empty; text is trimmed and control characters are
 * stripped. `title`, `who`, `note` and every item text are data, never instructions.
 */
import { cleanText } from '@/lib/text';
import { DATE_RE } from '@/lib/time';

export type SlipKind = 'metal' | 'diamond' | 'scrap' | 'casting';
export const SLIP_KINDS: readonly SlipKind[] = ['metal', 'diamond', 'scrap', 'casting'];
export type SlipSource = 'scan' | 'manual' | 'monday' | 'import';
export type ScrapDir = 'in' | 'out';

export interface MetalLine {
  item: string;
  qty: number | null;
  before: number | null;
  after: number | null;
}
export interface DiamondLine {
  quality: string;
  size: number | null;
  carats: number | null;
  price: number | null;
}
export interface ScrapLine {
  what: string;
  karat: string;
  grams: number | null;
  value: number | null;
}
export interface CastingLine {
  type: string;
  item: string;
  karat: string;
  yellow: number | null;
  white: number | null;
  rose: number | null;
  weight: number | null;
  price: number | null;
}

interface SlipBase {
  id: string;
  who: string;
  /** YYYY-MM-DD — the day on the paper slip / board row */
  date: string;
  note: string;
  source: SlipSource;
  /** ISO timestamp of the save */
  createdAt: string;
  /** staff name or token label that saved it; absent on imported rows */
  createdBy?: string;
}

export interface MetalSlip extends SlipBase {
  kind: 'metal';
  lines: MetalLine[];
  /** dust / filings handed back, grams */
  dust: number | null;
}
export interface DiamondSlip extends SlipBase {
  kind: 'diamond';
  lines: DiamondLine[];
}
export interface ScrapSlip extends SlipBase {
  kind: 'scrap';
  dir: ScrapDir;
  /** who received an outgoing batch; empty for `in` */
  to: string;
  lines: ScrapLine[];
}
export interface CastingSlip extends SlipBase {
  kind: 'casting';
  lines: CastingLine[];
}

export type Slip = MetalSlip | DiamondSlip | ScrapSlip | CastingSlip;
export type SlipLine = MetalLine | DiamondLine | ScrapLine | CastingLine;
/** What a client sends: everything but the server-assigned fields. */
export type SlipInput = Omit<MetalSlip, 'id' | 'createdAt' | 'createdBy'> | Omit<DiamondSlip, 'id' | 'createdAt' | 'createdBy'> | Omit<ScrapSlip, 'id' | 'createdAt' | 'createdBy'> | Omit<CastingSlip, 'id' | 'createdAt' | 'createdBy'>;

export interface Column {
  key: string;
  label: string;
  type: 'text' | 'num';
  /** decimals shown */
  dp?: number;
  /** placeholder for the form */
  ph?: string;
  /** form column width */
  w?: string;
}

export interface KindSpec {
  title: string;
  short: string;
  who: string;
  item: string;
  cols: readonly Column[];
}

/** The four sections exactly as the artifact defined them (columns = form + log table). */
export const KINDS: Record<SlipKind, KindSpec> = {
  metal: {
    title: 'Gold dust at bench',
    short: 'Gold dust',
    who: 'Jeweler',
    item: 'line',
    cols: [
      { key: 'item', label: 'Item / order #', type: 'text', ph: '71900, chain…' },
      { key: 'qty', label: 'Qty', type: 'num', dp: 0, w: '52px' },
      { key: 'before', label: 'Before g', type: 'num' },
      { key: 'after', label: 'After g', type: 'num' },
    ],
  },
  diamond: {
    title: 'Diamonds',
    short: 'Diamonds',
    who: 'Counted by',
    item: 'size',
    cols: [
      { key: 'quality', label: 'Quality', type: 'text', ph: 'SI, VS-SI…' },
      { key: 'size', label: 'Size mm', type: 'num' },
      { key: 'carats', label: 'Ct', type: 'num' },
      { key: 'price', label: '$/ct', type: 'num' },
    ],
  },
  scrap: {
    title: 'Scrap',
    short: 'Scrap',
    who: 'Logged by',
    item: 'piece',
    cols: [
      { key: 'what', label: 'Item / order #', type: 'text', ph: '251870 chain' },
      { key: 'karat', label: 'Karat', type: 'text', w: '74px', ph: '14KY' },
      { key: 'grams', label: 'Grams', type: 'num' },
      { key: 'value', label: '$', type: 'num', dp: 0, w: '70px' },
    ],
  },
  casting: {
    title: 'Rina casting inventory',
    short: 'Castings',
    who: 'Counted by',
    item: 'item',
    cols: [
      { key: 'type', label: 'Type', type: 'text', ph: 'Ring, Earring…', w: '90px' },
      { key: 'item', label: 'Item #', type: 'text', w: '80px' },
      { key: 'karat', label: 'K', type: 'text', w: '52px' },
      { key: 'yellow', label: 'Y', type: 'num', dp: 0, w: '48px' },
      { key: 'white', label: 'W', type: 'num', dp: 0, w: '48px' },
      { key: 'rose', label: 'R', type: 'num', dp: 0, w: '48px' },
      { key: 'weight', label: 'g/pc', type: 'num', w: '64px' },
      { key: 'price', label: '$/g', type: 'num', dp: 0, w: '56px' },
    ],
  },
};

export const SLIP_ID_RE = /^[a-z0-9][a-z0-9._-]{0,79}$/;
export const WHO_MAX = 60;
export const NOTE_MAX = 1000;
export const TEXT_MAX = 120;
export const LINES_MAX = 300;
export const NUMBER_MAX = 1e9;
export const SOURCES: readonly SlipSource[] = ['scan', 'manual', 'monday', 'import'];

export function isSlipKind(v: unknown): v is SlipKind {
  return typeof v === 'string' && (SLIP_KINDS as readonly string[]).includes(v);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** A number cell: number, numeric string (comma decimal allowed), empty → null; anything else → undefined (invalid). */
export function numberCell(v: unknown): number | null | undefined {
  if (v === null || v === undefined || v === '') return null;
  let n: number;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string') {
    const s = v.trim().replace(',', '.').replace(/^\$/, '');
    if (s === '') return null;
    if (!/^-?\d*\.?\d+(e-?\d+)?$/i.test(s) && !/^-?\d+\.$/.test(s)) return undefined;
    n = Number(s);
  } else return undefined;
  if (!Number.isFinite(n) || Math.abs(n) > NUMBER_MAX) return undefined;
  return Math.round(n * 1e6) / 1e6;
}

function textCell(v: unknown): string | undefined {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v !== 'string') return undefined;
  return cleanText(v, TEXT_MAX);
}

/** A line is kept when at least one of its cells holds something (mirrors the form). */
export function cleanLine(kind: SlipKind, raw: unknown): SlipLine | null | undefined {
  if (!isRecord(raw)) return undefined;
  const out: Record<string, string | number | null> = {};
  let filled = false;
  for (const c of KINDS[kind].cols) {
    if (c.type === 'num') {
      const n = numberCell(raw[c.key]);
      if (n === undefined) return undefined;
      out[c.key] = n;
      if (n !== null) filled = true;
    } else {
      const t = textCell(raw[c.key]);
      if (t === undefined) return undefined;
      out[c.key] = t;
      if (t !== '') filled = true;
    }
  }
  if (!filled) return null;
  return out as unknown as SlipLine;
}

export type Validation<T> = { ok: true; value: T } | { ok: false; error: string };

/** Karat text as the ledger groups it: uppercase, no spaces, `10TT` → `10KTT`; empty → `Unlabeled`. */
export function karatKey(raw: string | null | undefined): string {
  const k = String(raw ?? '')
    .toUpperCase()
    .replace(/\s/g, '');
  return k ? k.replace(/^(\d+)TT$/, '$1KTT') : 'Unlabeled';
}

/**
 * `Mr.Kim`, `mr kim`, `Mrs Kim` → `Mr. Kim` / `Mrs. Kim`: a title is a whole word (`Drew` and
 * `Msomi` are left alone), gets its dot and a space; whitespace collapses; an all-lowercase
 * word gets a capital. Other spellings are kept as typed (`MR. KIM` → `Mr. KIM`).
 */
export function normalizeName(raw: string | null | undefined): string {
  const s = cleanText(String(raw ?? ''), WHO_MAX);
  if (!s) return '';
  const spaced = s.replace(/\b(mrs|mr|ms|dr)\b\.?\s*/gi, (_m, t: string) => `${t[0]!.toUpperCase()}${t.slice(1).toLowerCase()}. `).replace(/\s+/g, ' ').trim();
  return spaced
    .split(' ')
    .map((w) => (w.length > 0 && w === w.toLowerCase() ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/** Lowercase alphanumerics only: the key that matches `Mr. Kim`, `mr kim` and `MR.KIM`. */
export function nameKey(name: string | null | undefined): string {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** A real calendar day as `YYYY-MM-DD` (2026-02-30 is not one), else null. */
export function validDate(v: unknown): string | null {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : v;
}

/** Validate a slip body from a client or a board; the result is the stored shape minus `id` / `createdAt` / `createdBy`. */
export function validateSlipInput(raw: unknown): Validation<SlipInput> {
  if (!isRecord(raw)) return { ok: false, error: 'Body must be a JSON object' };
  if (!isSlipKind(raw.kind)) return { ok: false, error: `"kind" must be one of ${SLIP_KINDS.join(', ')}` };
  const kind = raw.kind;
  const who = raw.who === undefined || raw.who === null ? '' : typeof raw.who === 'string' ? cleanText(raw.who, WHO_MAX) : null;
  if (who === null) return { ok: false, error: '"who" must be a string' };
  const date = validDate(raw.date);
  if (!date) return { ok: false, error: '"date" must be YYYY-MM-DD' };
  const note = raw.note === undefined || raw.note === null ? '' : typeof raw.note === 'string' ? cleanText(raw.note, NOTE_MAX) : null;
  if (note === null) return { ok: false, error: '"note" must be a string' };
  const source: SlipSource = raw.source === undefined ? 'manual' : (SOURCES as readonly unknown[]).includes(raw.source) ? (raw.source as SlipSource) : 'manual';
  if (raw.lines !== undefined && !Array.isArray(raw.lines)) return { ok: false, error: '"lines" must be an array' };
  const rawLines = (raw.lines ?? []) as unknown[];
  if (rawLines.length > LINES_MAX) return { ok: false, error: `At most ${LINES_MAX} lines per slip` };
  const lines: SlipLine[] = [];
  for (const l of rawLines) {
    const c = cleanLine(kind, l);
    if (c === undefined) return { ok: false, error: 'A line holds a value that is not a number' };
    if (c) lines.push(c);
  }
  const base = { who, date, note, source };
  if (kind === 'metal') {
    const dust = numberCell(raw.dust);
    if (dust === undefined) return { ok: false, error: '"dust" must be a number' };
    if (lines.length === 0 && dust === null) return { ok: false, error: 'Add at least one line with a number, or the dust weight' };
    return { ok: true, value: { kind, ...base, lines: lines as MetalLine[], dust } };
  }
  if (lines.length === 0) return { ok: false, error: 'Add at least one line with a number' };
  if (kind === 'scrap') {
    const dir: ScrapDir = raw.dir === 'out' ? 'out' : 'in';
    const to = dir === 'out' ? (typeof raw.to === 'string' ? cleanText(raw.to, WHO_MAX) : '') : '';
    return { ok: true, value: { kind, ...base, dir, to, lines: lines as ScrapLine[] } };
  }
  if (kind === 'diamond') return { ok: true, value: { kind, ...base, lines: lines as DiamondLine[] } };
  return { ok: true, value: { kind, ...base, lines: lines as CastingLine[] } };
}

/** Validate a stored document (file store, Postgres row, import file). */
export function validateSlip(raw: unknown): Slip | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.id !== 'string' || !SLIP_ID_RE.test(raw.id)) return null;
  const input = validateSlipInput(raw);
  if (!input.ok) return null;
  const createdAt = typeof raw.createdAt === 'string' && !Number.isNaN(new Date(raw.createdAt).getTime()) ? raw.createdAt : null;
  if (!createdAt) return null;
  const createdBy = typeof raw.createdBy === 'string' ? cleanText(raw.createdBy, WHO_MAX) : undefined;
  return { id: raw.id, ...input.value, createdAt, ...(createdBy ? { createdBy } : {}) } as Slip;
}

/** Inventory settings (SPEC §14.3): who hands in a slip daily, per-person access, sync stamps. */
export interface SectionAccess {
  sections: SlipKind[];
  write: boolean;
}

export interface SyncStamp {
  at: string;
  ok: boolean;
  /** slips written on that run */
  count: number;
  error?: string;
}

export type SyncBoard = 'dust' | 'diamond' | 'scrap' | 'casting';
export const SYNC_BOARDS: readonly SyncBoard[] = ['dust', 'diamond', 'scrap', 'casting'];

export interface InventorySettings {
  v: 1;
  jewelers: string[];
  /** staff id → what they may see / do; absent = every section, may write */
  access: Record<string, SectionAccess>;
  /** scrap on hand counts rows dated on/after this day */
  scrap_since: string;
  last_sync: Partial<Record<SyncBoard, SyncStamp>>;
}

export const DEFAULT_JEWELERS = ['Chaerin', 'Mr. Sim', 'Mr. Kim'];
export const SCRAP_SINCE_DEFAULT = '2026-09-23';
export const JEWELERS_MAX = 30;

export function defaultInventorySettings(): InventorySettings {
  return { v: 1, jewelers: [...DEFAULT_JEWELERS], access: {}, scrap_since: SCRAP_SINCE_DEFAULT, last_sync: {} };
}

export function validateJewelers(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length > JEWELERS_MAX) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const n of raw) {
    if (typeof n !== 'string') return null;
    const name = cleanText(n, WHO_MAX);
    if (!name) continue;
    const key = nameKey(name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

export function validateAccess(raw: unknown): Record<string, SectionAccess> | null {
  if (!isRecord(raw)) return null;
  const out: Record<string, SectionAccess> = Object.create(null) as Record<string, SectionAccess>;
  for (const [id, v] of Object.entries(raw)) {
    if (!/^[a-z0-9_]{1,30}$/.test(id) || !isRecord(v) || !Array.isArray(v.sections)) return null;
    const sections: SlipKind[] = [];
    for (const s of v.sections) {
      if (!isSlipKind(s)) return null;
      if (!sections.includes(s)) sections.push(s);
    }
    const write = v.write === undefined ? true : v.write;
    if (typeof write !== 'boolean') return null;
    out[id] = { sections: SLIP_KINDS.filter((k) => sections.includes(k)), write };
  }
  return out;
}

export function validateInventorySettings(raw: unknown): InventorySettings | null {
  if (!isRecord(raw) || raw.v !== 1) return null;
  const jewelers = validateJewelers(raw.jewelers);
  const access = validateAccess(raw.access ?? {});
  const scrapSince = raw.scrap_since === undefined ? SCRAP_SINCE_DEFAULT : validDate(raw.scrap_since);
  if (!jewelers || !access || !scrapSince) return null;
  const lastSync: Partial<Record<SyncBoard, SyncStamp>> = {};
  if (raw.last_sync !== undefined) {
    if (!isRecord(raw.last_sync)) return null;
    for (const b of SYNC_BOARDS) {
      const s = raw.last_sync[b];
      if (s === undefined) continue;
      if (!isRecord(s) || typeof s.at !== 'string' || typeof s.ok !== 'boolean' || typeof s.count !== 'number') return null;
      lastSync[b] = { at: s.at, ok: s.ok, count: s.count, ...(typeof s.error === 'string' ? { error: s.error.slice(0, 300) } : {}) };
    }
  }
  return { v: 1, jewelers, access, scrap_since: scrapSince, last_sync: lastSync };
}
