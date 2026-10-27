import { requireReader } from '@/lib/auth/credential';
import { clientIp } from '@/lib/auth/csrf';
import { publicReadLimiter } from '@/lib/auth/ratelimit';
import { handle, json } from '@/lib/api/http';
import { PER_PAGE } from '@/lib/api/orders';
import { getEnv } from '@/lib/env';
import { badRequest, tooManyRequests } from '@/lib/errors';
import { listUniverse } from '@/lib/orders/service';
import { publicShape } from '@/lib/orders/shape';
import { parsePage } from '@/lib/validate';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = handle(async (req) => {
  const url = new URL(req.url);
  const cred = await requireReader(req.headers);
  if (!cred) {
    const limit = publicReadLimiter.check(clientIp(req.headers, getEnv().TRUST_PROXY));
    if (!limit.ok) throw tooManyRequests(limit.retryAfter);
  }
  const page = parsePage(url.searchParams.get('page'));
  if (page === null) throw badRequest('invalid_page', '"page" must be 1–100');
  const staleOnly = url.searchParams.get('stale') === '1';
  // Only credentialed callers may force a fresh walk of every page.
  const fresh = Boolean(cred) && url.searchParams.get('fresh') === '1';

  const { rows, truncated, checked_at } = await listUniverse({ fresh });
  const filtered = staleOnly ? rows.filter((r) => r.stale) : rows;
  const start = (page - 1) * PER_PAGE;
  const slice = filtered.slice(start, start + PER_PAGE);
  return json({
    page,
    per_page: PER_PAGE,
    total: filtered.length,
    truncated,
    checked_at,
    orders: cred ? slice : slice.map(publicShape),
  });
});
