import { requireReader } from '@/lib/auth/credential';
import { clientIp } from '@/lib/auth/csrf';
import { publicReadLimiter } from '@/lib/auth/ratelimit';
import { handle, json } from '@/lib/api/http';
import { getEnv } from '@/lib/env';
import { tooManyRequests } from '@/lib/errors';
import { publicStatuses } from '@/lib/settings/model';
import { getSettings } from '@/lib/settings/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Status list for agents. Nothing from `staff` is ever returned here. */
export const GET = handle(async (req) => {
  const cred = await requireReader(req.headers);
  if (!cred) {
    const limit = publicReadLimiter.check(clientIp(req.headers, getEnv().TRUST_PROXY));
    if (!limit.ok) throw tooManyRequests(limit.retryAfter);
  }
  const settings = await getSettings();
  return json({
    statuses: publicStatuses(settings),
    stale_after_days: settings.stale_after_days,
    work_days: settings.work_days,
  });
});
