import { createHash, timingSafeEqual } from 'node:crypto';
import type { ApiToken } from '@/lib/env';

/** Constant-time string compare: SHA-256 both sides, then timingSafeEqual. */
export function constantTimeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a, 'utf8').digest();
  const hb = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(ha, hb);
}

/** `Authorization: Bearer <token>` → token (null when absent or malformed). */
export function bearerFromHeader(authorization: string | null | undefined): string | null {
  if (!authorization) return null;
  const m = /^Bearer\s+([^\s]+)\s*$/i.exec(authorization);
  return m ? (m[1] ?? null) : null;
}

/** Match against every configured token (no early exit) and return the label. */
export function matchApiToken(bearer: string, tokens: readonly ApiToken[]): ApiToken | null {
  let found: ApiToken | null = null;
  for (const t of tokens) {
    if (constantTimeEqual(bearer, t.token)) found = t;
  }
  return found;
}
