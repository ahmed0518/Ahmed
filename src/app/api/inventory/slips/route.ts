import { handle, json, readJsonBody } from '@/lib/api/http';
import { csrfOk } from '@/lib/auth/csrf';
import { writeLimiter } from '@/lib/auth/ratelimit';
import { getEnv } from '@/lib/env';
import { forbidden, tooManyRequests } from '@/lib/errors';
import { createSlip, requireViewer } from '@/lib/inventory/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Save one slip (the review form's Save, or an agent). Body = the slip without id / createdAt. */
export const POST = handle(async (req) => {
  const { viewer } = await requireViewer(req.headers);
  if (viewer.kind === 'staff' || viewer.kind === 'admin') {
    if (!csrfOk(req.headers, getEnv().TRUST_PROXY)) throw forbidden('csrf');
  }
  const limit = writeLimiter.check(`inventory:${viewer.kind}:${viewer.id ?? 'admin'}`);
  if (!limit.ok) throw tooManyRequests(limit.retryAfter);
  const body = await readJsonBody(req);
  const slip = await createSlip(viewer, body);
  return json({ slip }, { status: 201 });
});
