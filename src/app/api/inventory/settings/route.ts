import { handle, json, readJsonBody } from '@/lib/api/http';
import { csrfOk } from '@/lib/auth/csrf';
import { getEnv } from '@/lib/env';
import { badRequest, forbidden } from '@/lib/errors';
import { validateAccess, validateJewelers } from '@/lib/inventory/model';
import { requireViewer } from '@/lib/inventory/service';
import { getInventoryStore } from '@/lib/inventory/store';
import { getStaff } from '@/lib/settings/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Owners only: the jewelers list and who sees which section. Never anything from the staff roster but ids and names. */
export const GET = handle(async (req) => {
  const { viewer, settings } = await requireViewer(req.headers);
  if (!viewer.owner) throw forbidden('owner_required');
  const roster = await getStaff();
  return json({
    jewelers: settings.jewelers,
    access: settings.access,
    scrap_since: settings.scrap_since,
    last_sync: settings.last_sync,
    staff: roster.staff.filter((s) => s.active).map((s) => ({ id: s.id, name: s.name })),
  });
});

export const PUT = handle(async (req) => {
  const { viewer } = await requireViewer(req.headers);
  if (!viewer.owner) throw forbidden('owner_required');
  if ((viewer.kind === 'staff' || viewer.kind === 'admin') && !csrfOk(req.headers, getEnv().TRUST_PROXY)) throw forbidden('csrf');
  const body = await readJsonBody(req);
  const jewelers = body.jewelers === undefined ? undefined : validateJewelers(body.jewelers);
  if (jewelers === null) throw badRequest('invalid_jewelers', '"jewelers" must be a list of names');
  const access = body.access === undefined ? undefined : validateAccess(body.access);
  if (access === null) throw badRequest('invalid_access', '"access" must map staff ids to { sections, write }');
  if (jewelers === undefined && access === undefined) throw badRequest('nothing_to_save', 'Send "jewelers" and/or "access"');
  const next = await getInventoryStore().updateSettings((s) => ({ ...s, ...(jewelers ? { jewelers } : {}), ...(access ? { access } : {}) }));
  return json({ jewelers: next.jewelers, access: next.access });
});
