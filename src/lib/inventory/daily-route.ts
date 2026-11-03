/** The handler behind GET/POST /api/inventory/daily and the cron path /api/inventory/daily/notify (SPEC §14.11). */
import { json } from '@/lib/api/http';
import { csrfOk } from '@/lib/auth/csrf';
import { bearerFromHeader, constantTimeEqual } from '@/lib/auth/tokens';
import { getEnv } from '@/lib/env';
import { badRequest, forbidden, unauthorized } from '@/lib/errors';
import { dailyCheck, formatDailyReportSlack } from './daily';
import { validDate } from './model';
import { postToSlack, slackEnabled } from './notify';
import { todayIn, viewerFor } from './service';
import { getInventoryStore } from './store';
import { getSettings } from '@/lib/settings/store';
import { log } from '@/lib/log';

/**
 * The daily inventory check (SPEC §14.11). Any credential may read it; `?date=YYYY-MM-DD`
 * re-runs an earlier day (400 `invalid_date` for anything else). `?notify=1` also posts it to
 * Slack: on GET only with a bearer — the Vercel cron (`Authorization: Bearer $CRON_SECRET`)
 * or an API token — and on POST for an owner's session (CSRF-checked), so a link an owner is
 * tricked into opening can never post.
 */
export async function runDaily(req: Request, opts: { notify?: boolean } = {}): Promise<Response> {
  const env = getEnv();
  const url = new URL(req.url);
  const notify = opts.notify ?? url.searchParams.get('notify') === '1';
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
  const [slips, settings] = await Promise.all([store.listSlips(), store.getSettings()]);
  // the production settings only lend their work days; a Shopify hiccup must not sink the report
  let workDays: number[] = [1, 2, 3, 4, 5];
  try {
    workDays = (await getSettings()).work_days;
  } catch (e) {
    log.warn('daily check: could not read work_days from Shopify, assuming Mon–Fri', { detail: e instanceof Error ? e.message : String(e) });
  }
  const report = dailyCheck(slips, settings, today, { workDays, syncEnabled: env.MONDAY_API_TOKEN !== null, now: new Date().toISOString() });
  let posted = false;
  if (notify && slackEnabled()) {
    await postToSlack(formatDailyReportSlack(report, { link: env.INVENTORY_PUBLIC_URL ? `${env.INVENTORY_PUBLIC_URL}/inventory` : undefined }));
    posted = true;
  } else if (notify) log.warn('daily check: notify requested but SLACK_WEBHOOK_URL is not set — nothing posted');
  return json({ ...report, posted, slack_enabled: slackEnabled() });
}

