/**
 * Posting the daily report to Slack (SPEC §14.11) through an Incoming Webhook
 * (`SLACK_WEBHOOK_URL`): one URL, bound to one channel, no OAuth. Off when the variable is
 * empty — the report is still available at `GET /api/inventory/daily`.
 */
import { getEnv } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { log } from '@/lib/log';

export function slackEnabled(): boolean {
  return getEnv().SLACK_WEBHOOK_URL !== null;
}

/** POST the message; 503 `slack_unavailable` without a webhook, 502 `slack_failed` on a non-2xx answer. */
export async function postToSlack(message: { text: string; blocks?: unknown[] }, fetchImpl: typeof fetch = fetch): Promise<void> {
  const url = getEnv().SLACK_WEBHOOK_URL;
  if (!url) throw new AppError(503, 'slack_unavailable', 'Slack is not set up on this server (SLACK_WEBHOOK_URL).');
  let res: Response;
  try {
    res = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(message), signal: AbortSignal.timeout(15_000) });
  } catch (e) {
    throw new AppError(502, 'slack_failed', 'Slack did not accept the report', { detail: e instanceof Error ? e.message : String(e) });
  }
  if (!res.ok) throw new AppError(502, 'slack_failed', 'Slack did not accept the report', { detail: `HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}` });
  log.info('daily report posted to Slack', { chars: message.text.length });
}
