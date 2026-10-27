import { ADMIN_COOKIE, ADMIN_TTL_SECONDS, serializeCookie, signCookie } from '@/lib/auth/cookies';
import { clientIp, csrfOk } from '@/lib/auth/csrf';
import { isLocked, lockRemainingSeconds, recordFailure } from '@/lib/auth/pin';
import { adminLoginLimiter } from '@/lib/auth/ratelimit';
import { constantTimeEqual } from '@/lib/auth/tokens';
import { handle, json, readJsonBody } from '@/lib/api/http';
import { getEnv } from '@/lib/env';
import { AppError, badRequest, forbidden, notFound, tooManyRequests } from '@/lib/errors';
import { log } from '@/lib/log';
import { getSettings, updateSettings } from '@/lib/settings/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** `/admin` passcode → `trax_admin` cookie (12 h). Lockout persisted in `settings`. */
export const POST = handle(async (req) => {
  const env = getEnv();
  if (!env.ADMIN_PASSCODE) throw notFound();
  if (!csrfOk(req.headers)) throw forbidden('csrf');
  const body = await readJsonBody(req);
  const passcode = typeof body.passcode === 'string' ? body.passcode : '';
  if (passcode.length === 0 || passcode.length > 200) throw badRequest('invalid_passcode', 'Enter the passcode');

  const ip = clientIp(req.headers, env.TRUST_PROXY);
  const limit = adminLoginLimiter.check(ip);
  if (!limit.ok) throw tooManyRequests(limit.retryAfter);

  const settings = await getSettings({ fresh: true });
  const now = new Date();
  const lock = { failed_attempts: settings.admin_failed_attempts, locked_until: settings.admin_locked_until };
  if (isLocked(lock, now)) {
    const retryAfter = lockRemainingSeconds(lock, now);
    log.warn('admin login refused: locked', { ip, retryAfter });
    throw new AppError(429, 'locked', 'Too many wrong passcodes — try again later', { retryAfter });
  }

  if (!constantTimeEqual(passcode, env.ADMIN_PASSCODE)) {
    const next = recordFailure(lock, now);
    await updateSettings((s) => ({ ...s, admin_failed_attempts: next.failed_attempts, admin_locked_until: next.locked_until }));
    log.warn('admin login failed', { ip, failed_attempts: next.failed_attempts });
    throw new AppError(401, 'invalid_passcode', 'Wrong passcode');
  }

  if (lock.failed_attempts > 0 || lock.locked_until) {
    await updateSettings((s) => ({ ...s, admin_failed_attempts: 0, admin_locked_until: null }));
  }
  const exp = Math.floor(now.getTime() / 1000) + ADMIN_TTL_SECONDS;
  const cookie = signCookie({ t: 'admin', exp }, env.SESSION_SECRET);
  log.info('admin login ok', { ip });
  return json({ ok: true }, { headers: { 'Set-Cookie': serializeCookie(ADMIN_COOKIE, cookie, { maxAge: ADMIN_TTL_SECONDS, secure: env.isProduction }) } });
});
