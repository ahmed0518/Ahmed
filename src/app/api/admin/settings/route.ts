import { requireAdmin } from '@/lib/auth/credential';
import { handle, json, readJsonBody } from '@/lib/api/http';
import { applySettingsForm, settingsForm } from '@/lib/admin/model';
import { getEnv } from '@/lib/env';
import { notFound } from '@/lib/errors';
import { log } from '@/lib/log';
import { invalidateOrderCaches } from '@/lib/orders/service';
import { updateSettings } from '@/lib/settings/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Replace the editable part of `trax_production.settings` (CAS; lock fields untouched). */
export const PUT = handle(async (req) => {
  if (!getEnv().ADMIN_PASSCODE) throw notFound();
  requireAdmin(req.headers);
  const body = await readJsonBody(req);
  const next = await updateSettings((current) => applySettingsForm(current, body));
  invalidateOrderCaches();
  log.info('settings updated', { statuses: next.statuses.length, stale_after_days: next.stale_after_days });
  return json({ ok: true, settings: settingsForm(next) });
});
