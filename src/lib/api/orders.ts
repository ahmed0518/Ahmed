import type { Credential } from '@/lib/auth/credential';
import { badRequest, tooManyRequests } from '@/lib/errors';
import { writeLimiter } from '@/lib/auth/ratelimit';
import { cleanText } from '@/lib/status/merge';
import { NOTE_MAX, type Actor } from '@/lib/status/types';
import type { RawChange } from '@/lib/orders/service';
import { cleanBy, parseLineItemId, parseOrderNumber } from '@/lib/validate';

/** Shared validation for the order endpoints (SPEC §5, §7.1). */

export type Writer = Extract<Credential, { kind: 'staff' | 'token' }>;

const MAX_ITEMS_PER_WRITE = 100;
const STATUS_INPUT_MAX = 60;
export const PER_PAGE = 50;

/** Route param → validated order number (400 otherwise). */
export function numberFromParams(raw: string): string {
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    /* keep raw */
  }
  const number = parseOrderNumber(decoded);
  if (!number) throw badRequest('invalid_order_number', 'Order number must be 1–12 digits (e.g. 251548 or #251548)');
  return number;
}

export function writerKey(cred: Writer): string {
  return cred.kind === 'staff' ? `staff:${cred.id}` : `token:${cred.label}`;
}

export function checkWriteLimit(cred: Writer): void {
  const res = writeLimiter.check(writerKey(cred));
  if (!res.ok) throw tooManyRequests(res.retryAfter);
}

/** `by` comes from the credential for staff; bearer callers may name the person. */
export function actorFor(cred: Writer, body: Record<string, unknown>): Actor {
  if (cred.kind === 'staff') {
    if (body.by !== undefined) throw badRequest('by_not_allowed', 'A staff session always writes under its own name — remove "by"');
    return { by: cred.name, source: 'web', via: `web:${cred.name}` };
  }
  let by = cred.label;
  if (body.by !== undefined) {
    const cleaned = cleanBy(body.by);
    if (!cleaned) throw badRequest('invalid_by', '"by" must be a non-empty string of at most 60 characters');
    by = cleaned;
  }
  return { by, source: 'api', via: `token:${cred.label}` };
}

export function noteFrom(body: Record<string, unknown>): string {
  if (body.note === undefined || body.note === null) return '';
  if (typeof body.note !== 'string') throw badRequest('invalid_note', '"note" must be a string');
  return cleanText(body.note, NOTE_MAX);
}

function statusValue(v: unknown, field: string): string | null {
  if (v === null) return null;
  if (typeof v !== 'string') throw badRequest('invalid_status', `${field} must be a status id or name, or null`);
  const s = v.trim();
  if (s.length === 0 || s.length > STATUS_INPUT_MAX) throw badRequest('invalid_status', `${field} must be 1–${STATUS_INPUT_MAX} characters`);
  return s;
}

/** `POST /api/orders/{n}/items/{id}` body → one change. */
export function singleChange(lineItemId: string, body: Record<string, unknown>): RawChange {
  if (!('status' in body)) throw badRequest('missing_status', 'Body needs "status" (a status id or name, or null)');
  return { lineItemId, status: statusValue(body.status, '"status"'), note: noteFrom(body) };
}

/** `POST /api/orders/{n}` body → bulk changes. */
export function bulkChanges(body: Record<string, unknown>): RawChange[] {
  const items = body.items;
  if (typeof items !== 'object' || items === null || Array.isArray(items)) {
    throw badRequest('invalid_items', '"items" must be an object of { "<lineItemId>": "<status>" | null }');
  }
  const keys = Object.keys(items as Record<string, unknown>);
  if (keys.length === 0) throw badRequest('invalid_items', '"items" is empty');
  if (keys.length > MAX_ITEMS_PER_WRITE) throw badRequest('invalid_items', `"items" has more than ${MAX_ITEMS_PER_WRITE} entries`);
  const note = noteFrom(body);
  const out: RawChange[] = [];
  for (const key of keys) {
    const id = parseLineItemId(key);
    if (!id) throw badRequest('invalid_line_item_id', `"${key.slice(0, 30)}" is not a line item id`);
    out.push({ lineItemId: id, status: statusValue((items as Record<string, unknown>)[key], `items["${id}"]`), note });
  }
  return out;
}
