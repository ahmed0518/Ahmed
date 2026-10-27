import { requireReader, requireWriter } from '@/lib/auth/credential';
import { clientIp } from '@/lib/auth/csrf';
import { publicReadLimiter } from '@/lib/auth/ratelimit';
import { handle, json, readJsonBody } from '@/lib/api/http';
import { actorFor, bulkChanges, checkWriteLimit, numberFromParams } from '@/lib/api/orders';
import { getEnv } from '@/lib/env';
import { tooManyRequests } from '@/lib/errors';
import { readOrder, readOrderPublic, writeOrderStatus } from '@/lib/orders/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ number: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  const number = numberFromParams((await params).number);
  const cred = await requireReader(req.headers);
  if (!cred) {
    const limit = publicReadLimiter.check(clientIp(req.headers, getEnv().TRUST_PROXY));
    if (!limit.ok) throw tooManyRequests(limit.retryAfter);
    return json(await readOrderPublic(number));
  }
  return json(await readOrder(number));
});

export const POST = handle<Ctx>(async (req, { params }) => {
  const number = numberFromParams((await params).number);
  const cred = await requireWriter(req.headers);
  checkWriteLimit(cred);
  const body = await readJsonBody(req);
  const actor = actorFor(cred, body);
  const changes = bulkChanges(body);
  return json(await writeOrderStatus(number, changes, actor));
});
