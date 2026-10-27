import { cleanText } from '@/lib/text';

/** Input validation (SPEC §7.1). Every function returns null for anything it does not accept. Pure; safe in the browser. */

const ORDER_NUMBER_RE = /^\d{1,12}$/;
export const LINE_ITEM_ID_RE = /^\d{1,20}$/;

/** `251548`, `#251548`, `Order 251548`, `order #251548` → `251548`. */
export function parseOrderNumber(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  let s = input.trim();
  s = s.replace(/^order\s*/i, '');
  s = s.replace(/^#\s*/, '');
  s = s.trim();
  if (!ORDER_NUMBER_RE.test(s)) return null;
  return String(Number(s));
}

export function parseLineItemId(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const s = input.trim();
  return LINE_ITEM_ID_RE.test(s) ? s : null;
}

/** `?page=` 1–100, default 1. */
export function parsePage(input: string | null): number | null {
  if (input === null || input === '') return 1;
  if (!/^\d{1,3}$/.test(input)) return null;
  const n = Number(input);
  return n >= 1 && n <= 100 ? n : null;
}

/** `?days=` finite 0–365 (fractions allowed); undefined when absent, null when invalid. */
export function parseDays(input: string | null): number | null | undefined {
  if (input === null || input === '') return undefined;
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(input)) return null;
  const n = Number(input);
  return Number.isFinite(n) && n >= 0 && n <= 365 ? n : null;
}

export const BY_MAX = 60;

export function cleanBy(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const s = cleanText(input, BY_MAX);
  return s.length > 0 ? s : null;
}

/** `/login?next=` must be a same-origin path: starts with `/` and not `//` or `/\`. */
export function safeNextPath(input: string | null | undefined): string {
  if (!input) return '/';
  return /^\/[^/\\]/.test(input) && input.length <= 300 ? input : '/';
}
