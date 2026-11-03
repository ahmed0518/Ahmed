import { handle, json, readJsonBody } from '@/lib/api/http';
import { csrfOk } from '@/lib/auth/csrf';
import { constantTimeEqual, bearerFromHeader } from '@/lib/auth/tokens';
import { getEnv } from '@/lib/env';
import { badRequest, forbidden, unauthorized } from '@/lib/errors';
import { SYNC_BOARDS, type SyncBoard } from '@/lib/inventory/model';
import { syncMonday } from '@/lib/inventory/monday';
import { viewerFor } from '@/lib/inventory/service';
import { getInventoryStore } from '@/lib/inventory/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

/**
 * Pull the four monday.com boards. Accepted from: the Vercel cron (`Authorization: Bearer
 * $CRON_SECRET`), an API token, or an owner's browser session. Body (optional, JSON):
 * `{ "boards": ["dust", "diamond"] }`.
 */
async function run(req: Request): Promise<Response> {
  const env = getEnv();
  const bearer = bearerFromHeader(req.headers.get('authorization'));
  let allowed = false;
  if (bearer && env.CRON_SECRET && constantTimeEqual(bearer, env.CRON_SECRET)) allowed = true;
  else {
    const { viewer } = await viewerFor(req.headers);
    if (viewer.kind === 'anonymous') throw unauthorized();
    if (viewer.kind === 'token' || viewer.owner) {
      if ((viewer.kind === 'staff' || viewer.kind === 'admin') && !csrfOk(req.headers, env.TRUST_PROXY)) throw forbidden('csrf');
      allowed = true;
    }
  }
  if (!allowed) throw forbidden('owner_required');
  let boards: SyncBoard[] = [...SYNC_BOARDS];
  if (req.method === 'POST' && (req.headers.get('content-type') ?? '').startsWith('application/json')) {
    const body = await readJsonBody(req);
    if (body.boards !== undefined) {
      if (!Array.isArray(body.boards) || body.boards.some((b) => !(SYNC_BOARDS as readonly unknown[]).includes(b))) throw badRequest('invalid_boards', `"boards" must be a list of ${SYNC_BOARDS.join(', ')}`);
      boards = body.boards as SyncBoard[];
    }
  }
  const results = await syncMonday(getInventoryStore(), boards);
  return json({ ok: results.every((r) => r.ok), results }, { status: results.every((r) => r.ok) ? 200 : 207 });
}

export const POST = handle(run);
/** Vercel cron calls with GET. */
export const GET = handle(run);
