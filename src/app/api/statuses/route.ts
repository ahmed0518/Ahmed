import { requireReader } from '@/lib/auth/credential';
import { handle, json } from '@/lib/api/http';
import { publicStatuses } from '@/lib/settings/model';
import { getSettings } from '@/lib/settings/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Status list for agents. Nothing from `staff` is ever returned here. */
export const GET = handle(async (req) => {
  await requireReader(req.headers);
  const settings = await getSettings();
  return json({
    statuses: publicStatuses(settings),
    stale_after_days: settings.stale_after_days,
    work_days: settings.work_days,
  });
});
