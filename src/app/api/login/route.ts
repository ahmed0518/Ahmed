import { STAFF_COOKIE, STAFF_TTL_SECONDS, serializeCookie, signCookie } from '@/lib/auth/cookies';
import { clientIp, csrfOk } from '@/lib/auth/csrf';
import { claimStaffAttempt, recordStaffSuccess } from '@/lib/auth/lockout';
import { PIN_RE, verifyPin } from '@/lib/auth/pin';
import { loginLimiter } from '@/lib/auth/ratelimit';
import { handle, json, readJsonBody } from '@/lib/api/http';
import { getEnv } from '@/lib/env';
import { AppError, badRequest, forbidden, tooManyRequests } from '@/lib/errors';
import { log } from '@/lib/log';
import { STAFF_ID_RE } from '@/lib/settings/model';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Staff login (SPEC §5): name + PIN → `trax_staff` cookie. The attempt is counted in the
 * persisted roster (CAS, fresh read) before the PIN is verified, so a burst of parallel
 * guesses cannot slip past the lockout; a successful login resets the counter.
 */
export const POST = handle(async (req) => {
  const env = getEnv();
  if (!csrfOk(req.headers, env.TRUST_PROXY)) throw forbidden('csrf');
  const body = await readJsonBody(req);
  const id = typeof body.id === 'string' ? body.id.trim() : '';
  const pin = typeof body.pin === 'string' ? body.pin.trim() : '';
  if (!STAFF_ID_RE.test(id)) throw badRequest('invalid_login', 'Pick your name');
  if (!PIN_RE.test(pin)) throw badRequest('invalid_login', 'PIN must be 4–8 digits');

  const ip = clientIp(req.headers, env.TRUST_PROXY);
  // Keyed by name only: a spoofed IP header must not widen the per-name throttle.
  const limit = loginLimiter.check(id);
  if (!limit.ok) throw tooManyRequests(limit.retryAfter);

  const now = new Date();
  const entry = await claimStaffAttempt(id, now);
  if (!entry) {
    log.warn('login failed: unknown or inactive name', { name: id, ip });
    throw new AppError(401, 'invalid_login', 'Wrong name or PIN');
  }

  if (!verifyPin(env.PIN_PEPPER, entry.id, pin, entry.pin_hash)) {
    log.warn('login failed: wrong pin', { name: entry.name, ip, failed_attempts: entry.failed_attempts, locked_until: entry.locked_until });
    throw new AppError(401, 'invalid_login', 'Wrong name or PIN');
  }

  await recordStaffSuccess(entry.id);

  const exp = Math.floor(now.getTime() / 1000) + STAFF_TTL_SECONDS;
  const cookie = signCookie({ t: 'staff', id: entry.id, name: entry.name, sv: entry.session_version, exp }, env.SESSION_SECRET);
  log.info('login ok', { name: entry.name, ip });
  return json(
    { ok: true, name: entry.name },
    { headers: { 'Set-Cookie': serializeCookie(STAFF_COOKIE, cookie, { maxAge: STAFF_TTL_SECONDS, secure: env.isProduction }) } },
  );
});
