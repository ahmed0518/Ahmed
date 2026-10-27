import { NextResponse } from 'next/server';
import { AppError, badRequest, tooLarge, unsupportedMediaType } from '@/lib/errors';
import { log, newRef } from '@/lib/log';

/** Route-handler plumbing: JSON responses, the error shape, body parsing (SPEC §7, §7.1). */

export const BODY_MAX_BYTES = 16 * 1024;

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } as const;

export function json(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return NextResponse.json(body, { status: init.status ?? 200, headers: { ...JSON_HEADERS, ...(init.headers ?? {}) } });
}

export function errorResponse(e: unknown, path?: string): Response {
  const ref = newRef();
  if (e instanceof AppError) {
    const level = e.status >= 500 ? 'error' : 'warn';
    log[level]('request failed', { ref, path, status: e.status, code: e.code, message: e.message, detail: e.detail });
    const headers: Record<string, string> = {};
    if (e.retryAfter) headers['Retry-After'] = String(e.retryAfter);
    return json({ error: e.message, code: e.code, ref, ...(e.extra ?? {}) }, { status: e.status, headers });
  }
  log.error('unhandled error', { ref, path, detail: e instanceof Error ? `${e.name}: ${e.message}` : String(e) });
  return json({ error: 'Internal error', code: 'internal_error', ref }, { status: 500 });
}

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;

/** Wrap a handler so every thrown error becomes the documented JSON error shape. */
export function handle<C>(fn: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      return errorResponse(e, new URL(req.url).pathname);
    }
  };
}

/** `Content-Type: application/json` (415), ≤ 16 KB (413), valid JSON object (400). */
export async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  const type = req.headers.get('content-type') ?? '';
  if (!/^application\/json\s*(;|$)/i.test(type)) throw unsupportedMediaType();
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > BODY_MAX_BYTES) throw tooLarge('body_too_large', 'Request body is too large');
  const text = await req.text();
  if (Buffer.byteLength(text, 'utf8') > BODY_MAX_BYTES) throw tooLarge('body_too_large', 'Request body is too large');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw badRequest('invalid_json', 'Body is not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw badRequest('invalid_json', 'Body must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

export function text(body: string, init: { status?: number; contentType?: string } = {}): Response {
  return new NextResponse(body, {
    status: init.status ?? 200,
    headers: { 'Content-Type': init.contentType ?? 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
