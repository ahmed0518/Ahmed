import { handle, json } from '@/lib/api/http';
import { csrfOk } from '@/lib/auth/csrf';
import { RateLimiter } from '@/lib/auth/ratelimit';
import { getEnv } from '@/lib/env';
import { badRequest, forbidden, tooLarge, tooManyRequests } from '@/lib/errors';
import { isSlipKind } from '@/lib/inventory/model';
import { IMAGE_MAX_BYTES, isImageType, readSlipPhoto } from '@/lib/inventory/scan';
import { requireSection, requireViewer, requireWrite } from '@/lib/inventory/service';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

/** Photo reads cost money: 20 per minute per person. */
const scanLimiter = new RateLimiter(20, 60_000);

/** `multipart/form-data` with `kind` and `image` → the draft for the review form. Nothing is saved. */
export const POST = handle(async (req) => {
  const { viewer } = await requireViewer(req.headers);
  if ((viewer.kind === 'staff' || viewer.kind === 'admin') && !csrfOk(req.headers, getEnv().TRUST_PROXY)) throw forbidden('csrf');
  requireWrite(viewer);
  const limit = scanLimiter.check(`${viewer.kind}:${viewer.id ?? 'admin'}`);
  if (!limit.ok) throw tooManyRequests(limit.retryAfter);
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > IMAGE_MAX_BYTES + 16 * 1024) throw tooLarge('image_too_large', 'That photo is too large (8 MB max). Try a smaller one.');
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw badRequest('invalid_form', 'Send multipart/form-data with "kind" and "image"');
  }
  const kind = form.get('kind');
  if (!isSlipKind(kind)) throw badRequest('invalid_kind', '"kind" must be metal, diamond, scrap or casting');
  requireSection(viewer, kind);
  const image = form.get('image');
  if (!(image instanceof File)) throw badRequest('missing_image', 'Attach the photo as "image"');
  const type = image.type.toLowerCase();
  if (!isImageType(type)) throw badRequest('image_rejected', 'That image could not be used. Send a JPEG, PNG, WebP or GIF.');
  if (image.size > IMAGE_MAX_BYTES) throw tooLarge('image_too_large', 'That photo is too large (8 MB max). Try a smaller one.');
  const data = Buffer.from(await image.arrayBuffer());
  const draft = await readSlipPhoto(kind, { data, type }, req.signal);
  return json({ draft });
});
