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
 * every other cookie-authenticated mutation. The redirect is a relative `Location` on
 * purpose: the standalone server (Docker) only knows its bind address, so an absolute URL
 * built from `req.url` would send everyone to `localhost`.
 */
export const POST = handle(async (req) => {
  const env = getEnv();
  if (!csrfOk(req.headers, env.TRUST_PROXY)) throw forbidden('csrf');
  return new NextResponse(null, {
    status: 303,
    headers: {
      Location: '/login',
      'Set-Cookie': clearCookie(STAFF_COOKIE, env.isProduction),
      'Cache-Control': 'no-store',
    },
  });
});
