import { requireWriter } from '@/lib/auth/credential';
import { handle, json, readJsonBody } from '@/lib/api/http';
import { actorFor, checkWriteLimit, numberFromParams, singleChange } from '@/lib/api/orders';
import { badRequest } from '@/lib/errors';
import { writeOrderStatus } from '@/lib/orders/service';
import { parseLineItemId } from '@/lib/validate';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ number: string; lineItemId: string }> };

export const POST = handle<Ctx>(async (req, { params }) => {
  const p = await params;
  const number = numberFromParams(p.number);
  const lineItemId = parseLineItemId(p.lineItemId);
  if (!lineItemId) throw badRequest('invalid_line_item_id', 'Line item id must be 1–20 digits');
  const cred = await requireWriter(req.headers);
  checkWriteLimit(cred);
  const body = await readJsonBody(req);
  const actor = actorFor(cred, body);
  const change = singleChange(lineItemId, body);
  return json(await writeOrderStatus(number, [change], actor));
});
