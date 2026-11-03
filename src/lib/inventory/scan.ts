/**
 * Reading a photo of a paper slip (SPEC §14.6): the Anthropic Messages API with the image as
 * base64 and the prompts tuned to the real forms. The reply is parsed as JSON and reduced to
 * strings for the review form — nothing is saved until a person taps Save.
 */
import Anthropic from '@anthropic-ai/sdk';
import { getEnv } from '@/lib/env';
import { AppError, badRequest } from '@/lib/errors';
import { log } from '@/lib/log';
import { KINDS, type SlipKind } from './model';

export const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

export function isImageType(v: string): v is ImageType {
  return (IMAGE_TYPES as readonly string[]).includes(v);
}

/** The prompts, verbatim from the artifact (they are tuned to the real paper forms). */
export function scanPrompt(k: SlipKind, year: number = new Date().getFullYear()): string {
  const base = `This is a photo of a handwritten paper slip from a custom jewelry workshop. Read every number carefully: handwriting may be messy, and decimals may be written with a comma or a dot. Reply with ONLY one JSON object and no other text.\n`;
  if (k === 'metal')
    return (
      base +
      `The slip is a jeweler's bench sheet. The jeweler's name is usually stamped or written at the top, with a date. The printed columns are usually: From (who handed over the pieces), Order, Item (an order or item number, sometimes with a short description), Quantity (number of pieces), Start weight in grams, and Final weight in grams. The jeweler often writes the loss next to the final weight (for example "7.8 - 0.9") and a total loss at the bottom. Ditto marks (" or ") mean the same value as the row above, so repeat it.
At the bottom the jeweler may write a total loss and a "final" weight: the final weight is the dust and filings handed back.
JSON shape: {"who": the jeweler's name or null, "date": "YYYY-MM-DD" or null, "lines": [{"item": the order or item number plus any description, with the From name in parentheses if there is one, "qty": number or null, "before": start weight number or null, "after": final weight number or null}], "dust": the "final" dust weight as a number or null, "note": string}
Rules: one line per row. "after" is the final weight of that piece, never the loss. Skip total lines, but mention the written total loss in "note". If the year is missing, use ${year}. Put anything unclear, or a digit you were unsure about, in "note" (empty string if none).`
    );
  if (k === 'diamond')
    return (
      base +
      `The sheet is a diamond inventory count titled "Total Diamond Holding" with the quality grade in parentheses under the title (for example SI, VS-SI, VS2-SI1). It has three columns: Size (mm), ct weight (the total carats held in that size), and Comment, where a $ figure is the price per carat; a bracket drawn in the comment column groups several sizes under one price, so give that price to every size the bracket covers. Skip empty rows and ignore faint writing that shows through from another page.
JSON shape: {"who": string or null, "date": "YYYY-MM-DD" or null, "lines": [{"quality": the grade from the title, "size": number in mm, "carats": number or null, "price": number or null}], "note": string}
Rules: one line per size row, in the order written. Skip total lines. If the year is missing, use ${year}. Put anything unclear, or a bracket you could not follow, in "note" (empty string if none).`
    );
  if (k === 'casting')
    return (
      base +
      `The picture is a casting inventory table (a sheet or a screenshot of the CASTING INVENTORY board). Each row is one item number, with its type (Ring, Earring, Necklace, Cross, Frame…), how many pieces are on hand in Yellow, White and Rose gold, a total, the weight of one piece in grams, the karat (14K or 18K) and sometimes a $ per gram.
JSON shape: {"who": string or null, "date": "YYYY-MM-DD" or null, "lines": [{"type": string, "item": the item number as written, "karat": "14K" or "18K" or null, "yellow": number or null, "white": number or null, "rose": number or null, "weight": grams per piece or null, "price": $ per gram or null}], "note": string}
Rules: one line per item row. Skip total lines. Leave a colour null when nothing is written for it. If the year is missing, use ${year}. Put anything unclear in "note" (empty string if none).`
    );
  return (
    base +
    `The picture is a scrap gold list: a sheet or a screenshot of the scrap board. Each row is a piece or a batch with an item or order number, a karat such as 10KY, 14KY, 14KW, 14KR, 18KY (Y yellow, W white, R rose), a weight in grams and often a $ value. Decide the direction: rows that are pieces being scrapped are "in"; rows that are batches handed to someone (for example "Scrap for Mr Kim") or sent to the refinery are "out", and "to" is who received them.
JSON shape: {"who": string or null, "date": "YYYY-MM-DD" or null, "dir": "in" or "out", "to": string or null, "lines": [{"what": item or order number plus description, "karat": string or null, "grams": number or null, "value": number or null}], "note": string}
Rules: one line per row. Skip total lines. If the year is missing, use ${year}. Put anything unclear in "note" (empty string if none).`
  );
}

/** What the review form receives: every cell as a string, so the person can fix it before saving. */
export interface ScanDraft {
  kind: SlipKind;
  who: string;
  date: string | null;
  lines: Record<string, string>[];
  note: string;
  dust: string;
  dir: 'in' | 'out';
  to: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Reduce whatever JSON came back to the form's shape. Exported for tests. */
export function draftFromReply(kind: SlipKind, data: unknown): ScanDraft {
  const d = typeof data === 'object' && data !== null && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  const rawLines = Array.isArray(d.lines) ? d.lines : [];
  const lines = rawLines.slice(0, 300).map((l) => {
    const o: Record<string, string> = {};
    const rec = typeof l === 'object' && l !== null ? (l as Record<string, unknown>) : {};
    for (const c of KINDS[kind].cols) {
      const v = rec[c.key];
      o[c.key] = v === null || v === undefined ? '' : typeof v === 'string' || typeof v === 'number' ? String(v).slice(0, 120) : '';
    }
    return o;
  });
  const dust = typeof d.dust === 'number' && Number.isFinite(d.dust) ? String(d.dust) : typeof d.dust === 'string' ? d.dust.slice(0, 20) : '';
  return {
    kind,
    who: typeof d.who === 'string' ? d.who.slice(0, 60) : '',
    date: typeof d.date === 'string' && DATE_RE.test(d.date) ? d.date : null,
    lines,
    note: typeof d.note === 'string' ? d.note.slice(0, 1000) : '',
    dust: kind === 'metal' ? dust : '',
    dir: kind === 'scrap' && d.dir === 'out' ? 'out' : 'in',
    to: kind === 'scrap' && typeof d.to === 'string' ? d.to.slice(0, 60) : '',
  };
}

/** The model's text with any code fence removed; the first `{ … }` object is parsed. */
export function parseJsonReply(text: string): unknown {
  const stripped = text.replace(/```(?:json)?/gi, '').trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start < 0 || end <= start) throw badRequest('invalid_json', 'The slip could not be read into numbers. Try a sharper photo, or add it by hand.');
  try {
    return JSON.parse(stripped.slice(start, end + 1)) as unknown;
  } catch {
    throw badRequest('invalid_json', 'The slip could not be read into numbers. Try a sharper photo, or add it by hand.');
  }
}

let client: Anthropic | null = null;

export function scanEnabled(): boolean {
  return getEnv().ANTHROPIC_API_KEY !== null;
}

/** Read one photo. Throws 503 `scan_unavailable` without a key, 502 `scan_failed` when the API fails. */
export async function readSlipPhoto(kind: SlipKind, image: { data: Buffer; type: ImageType }, signal?: AbortSignal): Promise<ScanDraft> {
  const env = getEnv();
  if (!env.ANTHROPIC_API_KEY) throw new AppError(503, 'scan_unavailable', 'Photo reading is not set up on this server. Add the slip by hand.');
  if (image.data.byteLength > IMAGE_MAX_BYTES) throw new AppError(413, 'image_too_large', 'That photo is too large (8 MB max). Try a smaller one.');
  client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 90_000 });
  const started = Date.now();
  let response: Anthropic.Message;
  try {
    response = await client.messages.create(
      {
        model: env.ANTHROPIC_MODEL,
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: image.type, data: image.data.toString('base64') } },
              { type: 'text', text: scanPrompt(kind) },
            ],
          },
        ],
      },
      { signal },
    );
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) throw new AppError(503, 'scan_rate_limited', 'Too many scans right now. Wait a bit and try again.', { retryAfter: 30, detail: e.message });
    if (e instanceof Anthropic.AuthenticationError) throw new AppError(502, 'scan_failed', 'Could not reach Claude. Fill the slip in by hand, or try the scan again.', { detail: 'ANTHROPIC_API_KEY was refused' });
    if (e instanceof Anthropic.BadRequestError) throw new AppError(400, 'image_rejected', 'That image could not be used. Try a clearer or smaller photo.', { detail: e.message });
    if (e instanceof Anthropic.APIError) throw new AppError(502, 'scan_failed', 'Could not reach Claude. Fill the slip in by hand, or try the scan again.', { detail: `${e.status ?? ''} ${e.message}` });
    throw new AppError(502, 'scan_failed', 'Could not reach Claude. Fill the slip in by hand, or try the scan again.', { detail: e instanceof Error ? e.message : String(e) });
  }
  if (response.stop_reason === 'refusal') throw new AppError(422, 'refused', 'This photo could not be read. Try another one.');
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
  log.info('inventory scan', { kind, model: response.model, ms: Date.now() - started, input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens, stop: response.stop_reason });
  if (!text.trim()) throw new AppError(422, 'empty_completion', 'Nothing could be read from that photo. Try a sharper one.');
  return draftFromReply(kind, parseJsonReply(text));
}
