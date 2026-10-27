/**
 * Time helpers. Storage is UTC at second precision (`2026-10-27T15:12:03Z`); display uses
 * DISPLAY_TZ (America/New_York). Civil-date arithmetic is done on UTC day numbers so that no
 * library is needed.
 */

export const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const DAY_MS = 86_400_000;

/** `YYYY-MM-DDTHH:MM:SSZ` — seconds, no milliseconds. */
export function formatTimestamp(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Strict parse of the storage format; anything else (including a valid ISO with ms) is null. */
export function parseTimestamp(value: unknown): Date | null {
  if (typeof value !== 'string' || !TIMESTAMP_RE.test(value)) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  // Rejects impossible dates such as 2026-02-30 that Date would silently roll forward.
  return formatTimestamp(d) === value ? d : null;
}

/** Lenient parse for values Shopify writes (ISO 8601 with offset or milliseconds). */
export function parseIsoLenient(value: unknown): Date | null {
  if (typeof value !== 'string' || value.length < 10) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface CivilDate {
  y: number;
  m: number;
  d: number;
}

const civilFormatters = new Map<string, Intl.DateTimeFormat>();

function civilFormatter(tz: string): Intl.DateTimeFormat {
  let f = civilFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    civilFormatters.set(tz, f);
  }
  return f;
}

export function civilDate(d: Date, tz: string): CivilDate {
  const parts = civilFormatter(tz).formatToParts(d);
  let y = 0;
  let m = 0;
  let day = 0;
  for (const p of parts) {
    if (p.type === 'year') y = Number(p.value);
    else if (p.type === 'month') m = Number(p.value);
    else if (p.type === 'day') day = Number(p.value);
  }
  return { y, m, d: day };
}

export function civilToDayNumber(c: CivilDate): number {
  return Math.floor(Date.UTC(c.y, c.m - 1, c.d) / DAY_MS);
}

/** ISO weekday of a civil date: 1 = Monday … 7 = Sunday. */
export function isoWeekdayOfDayNumber(dayNumber: number): number {
  const wd = new Date(dayNumber * DAY_MS).getUTCDay();
  return wd === 0 ? 7 : wd;
}

/**
 * Number of civil dates d with date(since) < d <= date(now) (both in `tz`) whose ISO weekday
 * is in `workDays`. Friday 16:00 → Monday 10:00 = 1 with Mon–Fri.
 */
export function businessDaysSince(since: Date, now: Date, workDays: readonly number[], tz: string): number {
  const start = civilToDayNumber(civilDate(since, tz));
  const end = civilToDayNumber(civilDate(now, tz));
  if (end <= start) return 0;
  const set = new Set(workDays);
  let count = 0;
  const span = end - start;
  // Whole weeks can be counted arithmetically; the remainder is walked.
  const weeks = Math.floor(span / 7);
  if (weeks > 0) count += weeks * set.size;
  for (let day = start + weeks * 7 + 1; day <= end; day++) {
    if (set.has(isoWeekdayOfDayNumber(day))) count++;
  }
  return count;
}

/** Calendar days from a to b in `tz` (may be negative). */
export function calendarDaysBetween(a: Date, b: Date, tz: string): number {
  return civilToDayNumber(civilDate(b, tz)) - civilToDayNumber(civilDate(a, tz));
}

/** Hours since `since` divided by 24, one decimal, never negative. */
export function daysSince(since: Date, now: Date): number {
  const days = (now.getTime() - since.getTime()) / DAY_MS;
  return Math.max(0, Math.round(days * 10) / 10);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const timeFormatters = new Map<string, Intl.DateTimeFormat>();

function timeFormatter(tz: string): Intl.DateTimeFormat {
  let f = timeFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true });
    timeFormatters.set(tz, f);
  }
  return f;
}

/** `Oct 27` — with `, 2025` appended when the year differs from the current one. */
export function formatMonD(d: Date, tz: string, now: Date = new Date()): string {
  const c = civilDate(d, tz);
  const base = `${MONTHS[c.m - 1]} ${c.d}`;
  return c.y === civilDate(now, tz).y ? base : `${base}, ${c.y}`;
}

/** `Oct 27, 3:12 PM` — with the year when it differs from the current one. */
export function formatAbsolute(d: Date, tz: string, now: Date = new Date()): string {
  const time = timeFormatter(tz).format(d).replace(' ', ' ').replace(' ', ' ');
  return `${formatMonD(d, tz, now)}, ${time}`;
}

/** `YYYY-MM-DD` (a `date` metafield) → `Oct 30` / `Oct 30, 2027`. Anything else is returned raw. */
export function formatDateValue(value: string, now: Date = new Date(), tz = 'UTC'): string {
  if (!DATE_RE.test(value)) return value;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  if (!MONTHS[m - 1]) return value;
  const base = `${MONTHS[m - 1]} ${d}`;
  return y === civilDate(now, tz).y ? base : `${base}, ${y}`;
}

/**
 * `today` · `yesterday` · `N days ago` (calendar days in `tz`); 14 days or more shows the
 * absolute date. Rendered on the client.
 */
export function relativeDays(d: Date, now: Date, tz: string): string {
  const days = calendarDaysBetween(d, now, tz);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  return formatMonD(d, tz, now);
}
