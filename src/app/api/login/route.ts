import { STAFF_COOKIE, STAFF_TTL_SECONDS, serializeCookie, signCookie } from '@/lib/auth/cookies';
import { clientIp, csrfOk } from '@/lib/auth/csrf';
import { PIN_RE, isLocked, lockRemainingSeconds, recordFailure, recordSuccess, verifyPin } from '@/lib/auth/pin';
import { loginLimiter } from '@/lib/auth/ratelimit';
import { handle, json, readJsonBody } from '@/lib/api/http';
import { getEnv } from '@/lib/env';
import { AppError, badRequest, forbidden, tooManyRequests } from '@/lib/errors';
import { log } from '@/lib/log';
import { STAFF_ID_RE } from '@/lib/settings/model';
import { getStaff, updateStaff } from '@/lib/settings/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Staff login (SPEC §5): name + PIN → `trax_staff` cookie. The roster is read uncached, the
 * lockout counter is persisted with CAS so every instance sees it.
 */
export const POST = handle(async (req) => {
  const env = getEnv();
  if (!csrfOk(req.headers)) throw forbidden('csrf');
  const body = await readJsonBody(req);
  const id = typeof body.id === 'string' ? body.id.trim() : '';
  const pin = typeof body.pin === 'string' ? body.pin.trim() : '';
  if (!STAFF_ID_RE.test(id)) throw badRequest('invalid_login', 'Pick your name');
  if (!PIN_RE.test(pin)) throw badRequest('invalid_login', 'PIN must be 4–8 digits');

  const ip = clientIp(req.headers, env.TRUST_PROXY);
  const limit = loginLimiter.check(`${ip}|${id}`);
  if (!limit.ok) throw tooManyRequests(limit.retryAfter);

  const roster = await getStaff({ fresh: true });
  const entry = roster.staff.find((s) => s.id === id);
  const now = new Date();
  if (!entry || !entry.active) {
    log.warn('login failed: unknown or inactive name', { name: id, ip });
    throw new AppError(401, 'invalid_login', 'Wrong name or PIN');
  }
  if (isLocked(entry, now)) {
    const retryAfter = lockRemainingSeconds(entry, now);
    log.warn('login refused: locked', { name: entry.name, ip, retryAfter });
    throw new AppError(429, 'locked', 'Too many wrong PINs — try again later', { retryAfter });
  }

  if (!verifyPin(env.PIN_PEPPER, entry.id, pin, entry.pin_hash)) {
    const next = recordFailure(entry, now);
    await updateStaff((r) => ({
      ...r,
      staff: r.staff.map((s) => (s.id === entry.id ? { ...s, ...next } : s)),
    }));
    log.warn('login failed: wrong pin', { name: entry.name, ip, failed_attempts: next.failed_attempts, locked_until: next.locked_until });
    throw new AppError(401, 'invalid_login', 'Wrong name or PIN');
  }

  if (entry.failed_attempts > 0 || entry.locked_until) {
    await updateStaff((r) => ({
      ...r,
      staff: r.staff.map((s) => (s.id === entry.id ? { ...s, ...recordSuccess() } : s)),
    }));
  }

  const exp = Math.floor(now.getTime() / 1000) + STAFF_TTL_SECONDS;
  const cookie = signCookie({ t: 'staff', id: entry.id, name: entry.name, sv: entry.session_version, exp }, env.SESSION_SECRET);
  log.info('login ok', { name: entry.name, ip });
  return json(
    { ok: true, name: entry.name },
    { headers: { 'Set-Cookie': serializeCookie(STAFF_COOKIE, cookie, { maxAge: STAFF_TTL_SECONDS, secure: env.isProduction }) } },
  );
});
