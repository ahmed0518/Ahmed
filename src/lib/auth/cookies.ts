import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Signed cookies (SPEC §5): `base64url(payload).base64url(HMAC-SHA256(secret, payload))`.
 * Verification: parse → constant-time signature check → `t` → `exp`. The roster check for
 * staff cookies happens in `credential.ts`; the admin cookie carries a fingerprint of the
 * passcode it was issued for (`ph`), so rotating `ADMIN_PASSCODE` revokes every admin session.
 */

export const STAFF_COOKIE = 'trax_staff';
export const ADMIN_COOKIE = 'trax_admin';
export const STAFF_TTL_SECONDS = 30 * 24 * 3600;
export const ADMIN_TTL_SECONDS = 12 * 3600;

export interface StaffSession {
  t: 'staff';
  id: string;
  name: string;
  sv: number;
  exp: number;
}

export interface AdminSession {
  t: 'admin';
  exp: number;
  /** `passcodeFingerprint(ADMIN_PASSCODE)` at issue time */
  ph: string;
}

function hmac(secret: string, payload: string): Buffer {
  return createHmac('sha256', secret).update(payload).digest();
}

/** 16 hex chars of SHA-256(passcode): identifies which passcode an admin session was issued for. */
export function passcodeFingerprint(passcode: string): string {
  return createHash('sha256').update(passcode).digest('hex').slice(0, 16);
}

export function signCookie(payload: StaffSession | AdminSession, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = hmac(secret, body).toString('base64url');
  return `${body}.${sig}`;
}

function verifySignature(value: string, secret: string): Record<string, unknown> | null {
  const dot = value.indexOf('.');
  if (dot <= 0 || dot === value.length - 1) return null;
  const body = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  if (!/^[A-Za-z0-9_-]+$/.test(body) || !/^[A-Za-z0-9_-]+$/.test(sig)) return null;
  const expected = hmac(secret, body);
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function expValid(exp: unknown, now: Date): exp is number {
  return typeof exp === 'number' && Number.isFinite(exp) && exp > Math.floor(now.getTime() / 1000);
}

export function parseStaffCookie(value: string | null | undefined, secret: string, now: Date = new Date()): StaffSession | null {
  if (!value) return null;
  const p = verifySignature(value, secret);
  if (!p || p.t !== 'staff') return null;
  if (!expValid(p.exp, now)) return null;
  if (typeof p.id !== 'string' || typeof p.name !== 'string' || typeof p.sv !== 'number') return null;
  return { t: 'staff', id: p.id, name: p.name, sv: p.sv, exp: p.exp };
}

export function parseAdminCookie(value: string | null | undefined, secret: string, now: Date = new Date()): AdminSession | null {
  if (!value) return null;
  const p = verifySignature(value, secret);
  if (!p || p.t !== 'admin') return null;
  if (!expValid(p.exp, now)) return null;
  if (typeof p.ph !== 'string' || !/^[0-9a-f]{16}$/.test(p.ph)) return null;
  return { t: 'admin', exp: p.exp, ph: p.ph };
}

export function serializeCookie(name: string, value: string, opts: { maxAge: number; secure: boolean }): string {
  const parts = [`${name}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${opts.maxAge}`];
  if (opts.secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearCookie(name: string, secure: boolean): string {
  return serializeCookie(name, '', { maxAge: 0, secure });
}

export function parseCookieHeader(header: string | null | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name && !out.has(name)) out.set(name, value);
  }
  return out;
}
