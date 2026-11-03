/**
 * THE inventory maths (SPEC §14.2), ported one to one from the artifact's `metalRows`,
 * `latestCount`, `latestCasting` and `scrapSummary`. Pure; the page, the API summary and the
 * tests all go through here.
 */
import { karatKey, nameKey, type CastingLine, type CastingSlip, type DiamondLine, type DiamondSlip, type MetalSlip, type ScrapSlip, type Slip, type SlipKind } from './model';

export const num = (v: number | null | undefined): number | null => (v === null || v === undefined || !Number.isFinite(v) ? null : v);
const sum = <T>(arr: readonly T[], f: (x: T) => number | null | undefined): number => arr.reduce((t, x) => t + (num(f(x)) ?? 0), 0);

export function byKind<K extends SlipKind>(slips: readonly Slip[], kind: K): Extract<Slip, { kind: K }>[] {
  return slips.filter((s): s is Extract<Slip, { kind: K }> => s.kind === kind);
}

export type Period = 'today' | 'month' | 'all';

export function inPeriod(slip: Slip, period: Period, today: string): boolean {
  if (period === 'all') return true;
  if (period === 'today') return slip.date === today;
  return slip.date.startsWith(today.slice(0, 7));
}

// ---------- gold dust ----------
export const hasWeights = (s: MetalSlip): boolean => s.lines.some((l) => num(l.before) !== null || num(l.after) !== null);

export interface MetalRow {
  who: string;
  days: number;
  slips: number;
  before: number;
  after: number;
  pcs: number;
  dust: number;
  /** before − after over slips that also carry dust */
  pairedLoss: number;
  pairedDust: number;
  paired: number;
}

/** Per person: dust handed in, before/after over their slips, and the paired loss − dust. Sorted by dust, most first. */
export function metalRows(list: readonly MetalSlip[]): MetalRow[] {
  const m = new Map<string, MetalRow & { dayset: Set<string> }>();
  for (const s of list) {
    const key = s.who.trim() || 'Unnamed';
    const r = m.get(key) ?? { who: key, dayset: new Set<string>(), days: 0, slips: 0, before: 0, after: 0, pcs: 0, dust: 0, pairedLoss: 0, pairedDust: 0, paired: 0 };
    const d = num(s.dust);
    if (d !== null) {
      r.dust += d;
      r.dayset.add(s.date);
    }
    if (hasWeights(s)) {
      const b = sum(s.lines, (l) => l.before);
      const a = sum(s.lines, (l) => l.after);
      r.slips++;
      r.before += b;
      r.after += a;
      r.pcs += sum(s.lines, (l) => l.qty);
      if (d !== null) {
        r.paired++;
        r.pairedLoss += b - a;
        r.pairedDust += d;
      }
    }
    m.set(key, r);
  }
  return [...m.values()]
    .map(({ dayset, ...r }) => ({ ...r, days: dayset.size }))
    .sort((a, b) => b.dust - a.dust);
}

export interface MissingToday {
  in: string[];
  missing: string[];
}

/** Which jewelers have a slip dated today (name match ignores case and punctuation). */
export function missingToday(list: readonly MetalSlip[], jewelers: readonly string[], today: string): MissingToday {
  const have = new Set(list.filter((s) => s.date === today).map((s) => nameKey(s.who)));
  return { in: jewelers.filter((j) => have.has(nameKey(j))), missing: jewelers.filter((j) => !have.has(nameKey(j))) };
}

// ---------- diamonds ----------
export const qualityOf = (l: DiamondLine): string => l.quality.trim() || 'Unlabeled';

export interface SizeRow {
  size: number | null;
  carats: number;
  price: number | null;
  value: number | null;
}
export interface QualityGroup {
  quality: string;
  date: string;
  who: string;
  rows: SizeRow[];
  ct: number;
  value: number;
  unpriced: number;
}
export interface DiamondCount {
  date: string;
  groups: QualityGroup[];
  ct: number;
  /** number of size rows */
  n: number;
  value: number;
  unpriced: number;
}

/** Each grade shows its most recent sheet; pages scanned on the same day merge by size. */
export function latestCount(list: readonly DiamondSlip[]): DiamondCount | null {
  if (!list.length) return null;
  const latest = new Map<string, string>();
  for (const s of list) for (const l of s.lines) {
    const q = qualityOf(l);
    if (!latest.has(q) || s.date > (latest.get(q) ?? '')) latest.set(q, s.date);
  }
  const groups: QualityGroup[] = [];
  for (const [q, date] of latest) {
    const bySize = new Map<string, SizeRow>();
    const who = new Set<string>();
    for (const s of list) {
      if (s.date !== date) continue;
      for (const l of s.lines) {
        if (qualityOf(l) !== q) continue;
        const size = num(l.size);
        const key = size === null ? 'none' : String(size);
        const r = bySize.get(key) ?? { size, carats: 0, price: null, value: null };
        r.carats += num(l.carats) ?? 0;
        if (r.price === null) r.price = num(l.price);
        r.value = r.price === null ? null : r.carats * r.price;
        bySize.set(key, r);
        if (s.who) who.add(s.who);
      }
    }
    const rows = [...bySize.values()].sort((a, b) => (a.size ?? 999) - (b.size ?? 999));
    groups.push({
      quality: q,
      date,
      who: [...who].join(', '),
      rows,
      ct: rows.reduce((t, r) => t + r.carats, 0),
      value: rows.reduce((t, r) => t + (r.value ?? 0), 0),
      unpriced: rows.filter((r) => r.value === null).length,
    });
  }
  groups.sort((a, b) => a.quality.localeCompare(b.quality));
  const date = groups.reduce((d, g) => (g.date > d ? g.date : d), '');
  return {
    date,
    groups,
    ct: groups.reduce((t, g) => t + g.ct, 0),
    n: groups.reduce((t, g) => t + g.rows.length, 0),
    value: groups.reduce((t, g) => t + g.value, 0),
    unpriced: groups.reduce((t, g) => t + g.unpriced, 0),
  };
}

// ---------- castings ----------
export const pcsOf = (l: CastingLine): number | null => (num(l.yellow) === null && num(l.white) === null && num(l.rose) === null ? null : (num(l.yellow) ?? 0) + (num(l.white) ?? 0) + (num(l.rose) ?? 0));

export interface CastingRow {
  item: string;
  karat: string;
  yellow: number | null;
  white: number | null;
  rose: number | null;
  pcs: number;
  weight: number | null;
  grams: number | null;
  value: number | null;
}
export interface CastingGroup {
  type: string;
  rows: CastingRow[];
  pcs: number;
  grams: number;
  value: number;
  yellow: number;
  white: number;
  rose: number;
}
export interface CastingCount {
  date: string;
  who: string;
  groups: CastingGroup[];
  pcs: number;
  grams: number;
  value: number;
  yellow: number;
  white: number;
  rose: number;
  items: number;
}

/** The latest count day, by type then item: pieces = Y + W + R, grams = pieces × g/pc, value = grams × $/g. */
export function latestCasting(list: readonly CastingSlip[]): CastingCount | null {
  if (!list.length) return null;
  const date = list.reduce((d, s) => (s.date > d ? s.date : d), '');
  const who = new Set<string>();
  const types = new Map<string, CastingGroup>();
  for (const s of list) {
    if (s.date !== date) continue;
    if (s.who) who.add(s.who);
    for (const l of s.lines) {
      const t = l.type.trim() || 'Other';
      const g = types.get(t) ?? { type: t, rows: [], pcs: 0, grams: 0, value: 0, yellow: 0, white: 0, rose: 0 };
      const pcs = pcsOf(l) ?? 0;
      const w = num(l.weight);
      const p = num(l.price);
      const grams = w === null ? null : pcs * w;
      const value = grams === null || p === null ? null : grams * p;
      g.rows.push({ item: l.item, karat: l.karat, yellow: num(l.yellow), white: num(l.white), rose: num(l.rose), pcs, weight: w, grams, value });
      g.pcs += pcs;
      g.grams += grams ?? 0;
      g.value += value ?? 0;
      g.yellow += num(l.yellow) ?? 0;
      g.white += num(l.white) ?? 0;
      g.rose += num(l.rose) ?? 0;
      types.set(t, g);
    }
  }
  const groups = [...types.values()].sort((a, b) => b.pcs - a.pcs);
  for (const g of groups) g.rows.sort((a, b) => b.pcs - a.pcs);
  const tot = (k: 'pcs' | 'grams' | 'value' | 'yellow' | 'white' | 'rose') => groups.reduce((t, g) => t + g[k], 0);
  return { date, who: [...who].join(', '), groups, pcs: tot('pcs'), grams: tot('grams'), value: tot('value'), yellow: tot('yellow'), white: tot('white'), rose: tot('rose'), items: groups.reduce((t, g) => t + g.rows.length, 0) };
}

// ---------- scrap ----------
export interface KaratRow {
  karat: string;
  in: number;
  out: number;
  vin: number;
  vout: number;
}
export interface ScrapSummary {
  rows: KaratRow[];
  ins: number;
  outs: number;
  onhand: number;
  value: number;
  vin: number;
  vout: number;
  to: { to: string; grams: number; value: number }[];
  /** pieces scrapped in */
  pieces: number;
}

/** The ledger by karat: on hand = scrapped in − given out; `to` = where outgoing batches went. */
export function scrapSummary(list: readonly ScrapSlip[]): ScrapSummary {
  const byK = new Map<string, KaratRow>();
  const byTo = new Map<string, { to: string; grams: number; value: number }>();
  let ins = 0;
  let outs = 0;
  let vin = 0;
  let vout = 0;
  let pieces = 0;
  for (const s of list) {
    const out = s.dir === 'out';
    for (const l of s.lines) {
      const k = karatKey(l.karat);
      const g = num(l.grams) ?? 0;
      const v = num(l.value) ?? 0;
      const r = byK.get(k) ?? { karat: k, in: 0, out: 0, vin: 0, vout: 0 };
      if (out) {
        r.out += g;
        r.vout += v;
        outs += g;
        vout += v;
        const to = s.to.trim() || 'Unknown';
        const t = byTo.get(to) ?? { to, grams: 0, value: 0 };
        t.grams += g;
        t.value += v;
        byTo.set(to, t);
      } else {
        r.in += g;
        r.vin += v;
        ins += g;
        vin += v;
        pieces++;
      }
      byK.set(k, r);
    }
  }
  const rows = [...byK.values()].sort((a, b) => b.in - b.out - (a.in - a.out));
  return { rows, ins, outs, onhand: ins - outs, value: vin - vout, vin, vout, to: [...byTo.values()].sort((a, b) => b.grams - a.grams), pieces };
}

/** Scrap rows that count towards "on hand": dated on/after the cutover (older rows are history only). */
export function scrapSince(list: readonly ScrapSlip[], since: string): ScrapSlip[] {
  return list.filter((s) => s.date >= since);
}

// ---------- tiles ----------
export interface Tiles {
  metal: { dust: number; people: number; any: boolean };
  diamond: { ct: number; value: number; date: string } | null;
  casting: { pcs: number; value: number; date: string } | null;
  scrap: { onhand: number; value: number; any: boolean };
}

/** The four headline numbers, exactly as the tiles show them. */
export function tiles(slips: readonly Slip[], today: string, scrapCutover: string): Tiles {
  const m = byKind(slips, 'metal').filter((s) => s.date.startsWith(today.slice(0, 7)));
  const c = latestCount(byKind(slips, 'diamond'));
  const cc = latestCasting(byKind(slips, 'casting'));
  const scrap = scrapSince(byKind(slips, 'scrap'), scrapCutover);
  const sc = scrapSummary(scrap);
  return {
    metal: { dust: sum(m, (s) => s.dust), people: new Set(m.filter((s) => num(s.dust) !== null).map((s) => s.who.trim())).size, any: m.length > 0 },
    diamond: c ? { ct: c.ct, value: c.value, date: c.date } : null,
    casting: cc ? { pcs: cc.pcs, value: cc.value, date: cc.date } : null,
    scrap: { onhand: sc.onhand, value: sc.value, any: scrap.length > 0 },
  };
}

/** The one-line amount shown in the log for a slip. */
export function slipAmount(s: Slip): string {
  if (s.kind === 'metal') {
    if (!hasWeights(s)) return `${fmt(num(s.dust), 2)} g dust`;
    return `${fmt(sum(s.lines, (l) => l.before), 2)} → ${fmt(sum(s.lines, (l) => l.after), 2)} g`;
  }
  if (s.kind === 'diamond') {
    const q = [...new Set(s.lines.map(qualityOf))].join(', ');
    return `${fmt(sum(s.lines, (l) => l.carats), 2)} ct${q ? ` · ${q}` : ''}`;
  }
  if (s.kind === 'casting') return `${fmt(s.lines.reduce((t, l) => t + (pcsOf(l) ?? 0), 0), 0)} pcs · ${s.lines.length} items`;
  return `${s.dir === 'out' ? '−' : '+'}${fmt(sum(s.lines, (l) => l.grams), 2)} g${s.dir === 'out' ? ` → ${s.to || '?'}` : ''}`;
}

export function fmt(n: number | null | undefined, dp = 1): string {
  return n === null || n === undefined || !Number.isFinite(n) ? '—' : Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: dp });
}

export function money(v: number | null | undefined): string {
  return v === null || v === undefined || !Number.isFinite(v) ? '—' : `$${fmt(v, 0)}`;
}

/** Newest date first, then newest save first — the log order. */
export function sortSlips(list: readonly Slip[]): Slip[] {
  return [...list].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}
