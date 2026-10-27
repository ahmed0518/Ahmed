import { requireReader } from '@/lib/auth/credential';
import { clientIp } from '@/lib/auth/csrf';
import { publicReadLimiter } from '@/lib/auth/ratelimit';
import { handle, json } from '@/lib/api/http';
import { getEnv } from '@/lib/env';
import { badRequest, tooManyRequests } from '@/lib/errors';
import { listUniverse } from '@/lib/orders/service';
import { publicShape } from '@/lib/orders/shape';
import { getSettings } from '@/lib/settings/store';
import { parseDays } from '@/lib/validate';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** The complete stale set — what Maks's AI checks before emailing anyone. */
export const GET = handle(async (req) => {
  const url = new URL(req.url);
  const cred = await requireReader(req.headers);
  if (!cred) {
    const limit = publicReadLimiter.check(clientIp(req.headers, getEnv().TRUST_PROXY));
    if (!limit.ok) throw tooManyRequests(limit.retryAfter);
  }
  const days = parseDays(url.searchParams.get('days'));
  if (days === null) throw badRequest('invalid_days', '"days" must be a number between 0 and 365');
  const threshold = days ?? (await getSettings()).stale_after_days;
  const { rows, truncated, checked_at } = await listUniverse({ staleAfterDays: threshold });
  const stale = rows.filter((r) => r.stale);
  return json({
    days: threshold,
    checked_at,
    count: stale.length,
    never_set_count: stale.filter((r) => r.tracking === 'never_set').length,
    truncated,
    orders: cred ? stale : stale.map(publicShape),
  });
});
