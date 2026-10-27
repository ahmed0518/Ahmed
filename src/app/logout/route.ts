import { NextResponse } from 'next/server';
import { STAFF_COOKIE, clearCookie } from '@/lib/auth/cookies';
import { csrfOk } from '@/lib/auth/csrf';
import { handle } from '@/lib/api/http';
import { getEnv } from '@/lib/env';
import { forbidden } from '@/lib/errors';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST only (a `<form method="post">` button): a GET would be prefetched by `<Link>` and
 * could be triggered cross-site, logging staff out without their doing. Same CSRF rule as
 * every other cookie-authenticated mutation.
 */
export const POST = handle(async (req) => {
  const env = getEnv();
  if (!csrfOk(req.headers, env.TRUST_PROXY)) throw forbidden('csrf');
  const res = NextResponse.redirect(new URL('/login', req.url), 303);
  res.headers.set('Set-Cookie', clearCookie(STAFF_COOKIE, env.isProduction));
  res.headers.set('Cache-Control', 'no-store');
  return res;
});
