import { ADMIN_COOKIE, ADMIN_TTL_SECONDS, passcodeFingerprint, serializeCookie, signCookie } from '@/lib/auth/cookies';
import { clientIp, csrfOk } from '@/lib/auth/csrf';
import { claimAdminAttempt, recordAdminSuccess } from '@/lib/auth/lockout';
import { adminLoginLimiter } from '@/lib/auth/ratelimit';
import { constantTimeEqual } from '@/lib/auth/tokens';
import { handle, json, readJsonBody } from '@/lib/api/http';
import { getEnv } from '@/lib/env';
import { AppError, badRequest, forbidden, notFound, tooManyRequests } from '@/lib/errors';
import { log } from '@/lib/log';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * `/admin` passcode → `trax_admin` cookie (12 h), bound to the current passcode. The attempt
 * is counted in `settings` (CAS, fresh read) before the passcode is compared.
 */
export const POST = handle(async (req) => {
  const env = getEnv();
  if (!env.ADMIN_PASSCODE) throw notFound();
  if (!csrfOk(req.headers, env.TRUST_PROXY)) throw forbidden('csrf');
  const body = await readJsonBody(req);
  const passcode = typeof body.passcode === 'string' ? body.passcode : '';
  if (passcode.length === 0 || passcode.length > 200) throw badRequest('invalid_passcode', 'Enter the passcode');

  const ip = clientIp(req.headers, env.TRUST_PROXY);
  const limit = adminLoginLimiter.check(ip);
  if (!limit.ok) throw tooManyRequests(limit.retryAfter);

  const now = new Date();
  const claimed = await claimAdminAttempt(now);

  if (!constantTimeEqual(passcode, env.ADMIN_PASSCODE)) {
    log.warn('admin login failed', { ip, failed_attempts: claimed.failed_attempts, locked_until: claimed.locked_until });
    throw new AppError(401, 'invalid_passcode', 'Wrong passcode');
  }

  await recordAdminSuccess();
  const exp = Math.floor(now.getTime() / 1000) + ADMIN_TTL_SECONDS;
  const cookie = signCookie({ t: 'admin', exp, ph: passcodeFingerprint(env.ADMIN_PASSCODE) }, env.SESSION_SECRET);
  log.info('admin login ok', { ip });
  return json({ ok: true }, { headers: { 'Set-Cookie': serializeCookie(ADMIN_COOKIE, cookie, { maxAge: ADMIN_TTL_SECONDS, secure: env.isProduction }) } });
});
