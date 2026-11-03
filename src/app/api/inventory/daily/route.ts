import { handle, json } from '@/lib/api/http';
import { csrfOk } from '@/lib/auth/csrf';
import { bearerFromHeader, constantTimeEqual } from '@/lib/auth/tokens';
import { getEnv } from '@/lib/env';
import { badRequest, forbidden, unauthorized } from '@/lib/errors';
import { dailyCheck, formatDailyReportSlack } from '@/lib/inventory/daily';
import { validDate } from '@/lib/inventory/model';
import { postToSlack, slackEnabled } from '@/lib/inventory/notify';
import { todayIn, viewerFor } from '@/lib/inventory/service';
import { getInventoryStore } from '@/lib/inventory/store';
import { getSettings } from '@/lib/settings/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The daily inventory check (SPEC §14.11). Any credential may read it; `?date=YYYY-MM-DD`
 * re-runs an earlier day (400 `invalid_date` for anything else). `?notify=1` also posts it to
 * Slack: on GET only with a bearer — the Vercel cron (`Authorization: Bearer $CRON_SECRET`)
 * or an API token — and on POST for an owner's session (CSRF-checked), so a link an owner is
 * tricked into opening can never post.
 */
async function run(req: Request): Promise<Response> {
  const env = getEnv();
  const url = new URL(req.url);
  const notify = url.searchParams.get('notify') === '1';
  const bearer = bearerFromHeader(req.headers.get('authorization'));
  const cron = Boolean(bearer && env.CRON_SECRET && constantTimeEqual(bearer, env.CRON_SECRET));
  if (!cron) {
    const { viewer } = await viewerFor(req.headers);
    if (viewer.kind === 'anonymous') throw unauthorized();
    if (notify) {
      if (viewer.kind === 'token') {
        /* a bearer may post from GET or POST */
      } else if (viewer.owner && req.method === 'POST') {
        if (!csrfOk(req.headers, env.TRUST_PROXY)) throw forbidden('csrf');
      } else throw forbidden(viewer.owner ? 'post_required' : 'owner_required');
    }
  }
  const store = getInventoryStore();
  const requested = url.searchParams.get('date');
  const today = requested === null || requested === '' ? todayIn(env.DISPLAY_TZ) : validDate(requested);
  if (!today) throw badRequest('invalid_date', '"date" must be a real day as YYYY-MM-DD');
  const [slips, settings, production] = await Promise.all([store.listSlips(), store.getSettings(), getSettings()]);
  const report = dailyCheck(slips, settings, today, { workDays: production.work_days, syncEnabled: env.MONDAY_API_TOKEN !== null, now: new Date().toISOString() });
  let posted = false;
  if (notify && slackEnabled()) {
    await postToSlack(formatDailyReportSlack(report, { link: env.INVENTORY_PUBLIC_URL ? `${env.INVENTORY_PUBLIC_URL}/inventory` : undefined }));
    posted = true;
  }
  return json({ ...report, posted, slack_enabled: slackEnabled() });
}

export const GET = handle(run);
export const POST = handle(run);
