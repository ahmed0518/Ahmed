import { handle, json } from '@/lib/api/http';
import { getEnv } from '@/lib/env';
import { buildPayload, parseKindParam, requireViewer } from '@/lib/inventory/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Everything the inventory page shows, for the viewer's sections: `?kind=metal` narrows the slips (the tiles stay whole). */
export const GET = handle(async (req) => {
  const kind = parseKindParam(new URL(req.url).searchParams.get('kind'));
  const { viewer, settings } = await requireViewer(req.headers);
  return json(await buildPayload(viewer, settings, getEnv().DISPLAY_TZ, kind));
});
