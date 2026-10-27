import { NextResponse } from 'next/server';
import { STAFF_COOKIE, clearCookie } from '@/lib/auth/cookies';
import { getEnv } from '@/lib/env';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function logout(req: Request): Response {
  const res = NextResponse.redirect(new URL('/login', req.url), 303);
  res.headers.set('Set-Cookie', clearCookie(STAFF_COOKIE, getEnv().isProduction));
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

export function GET(req: Request): Response {
  return logout(req);
}

export function POST(req: Request): Response {
  return logout(req);
}
