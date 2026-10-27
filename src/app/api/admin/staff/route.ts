import { requireAdmin } from '@/lib/auth/credential';
import { hashPin } from '@/lib/auth/pin';
import { handle, json, readJsonBody } from '@/lib/api/http';
import { applyStaffAction, parseStaffAction, staffView } from '@/lib/admin/model';
import { getEnv } from '@/lib/env';
import { notFound } from '@/lib/errors';
import { log } from '@/lib/log';
import { updateStaff } from '@/lib/settings/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Roster actions: add, set_pin, rename, deactivate, activate, clear_lock. Never returns pin_hash. */
export const POST = handle(async (req) => {
  const env = getEnv();
  if (!env.ADMIN_PASSCODE) throw notFound();
  requireAdmin(req.headers);
  const body = await readJsonBody(req);
  const action = parseStaffAction(body);
  const next = await updateStaff((current) => applyStaffAction(current, action, (id, pin) => hashPin(env.PIN_PEPPER, id, pin)));
  log.info('staff updated', { action: action.action, id: 'id' in action ? action.id : undefined });
  return json({ ok: true, staff: staffView(next) });
});
