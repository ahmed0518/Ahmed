import { handle, json } from '@/lib/api/http';
import { csrfOk } from '@/lib/auth/csrf';
import { getEnv } from '@/lib/env';
import { badRequest, forbidden } from '@/lib/errors';
import { SLIP_ID_RE } from '@/lib/inventory/model';
import { deleteSlip, requireViewer } from '@/lib/inventory/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export const DELETE = handle<Ctx>(async (req, { params }) => {
  const { id } = await params;
  if (!SLIP_ID_RE.test(id)) throw badRequest('invalid_id', 'Not a slip id');
  const { viewer } = await requireViewer(req.headers);
  if ((viewer.kind === 'staff' || viewer.kind === 'admin') && !csrfOk(req.headers, getEnv().TRUST_PROXY)) throw forbidden('csrf');
  await deleteSlip(viewer, id);
  return json({ deleted: id });
});
