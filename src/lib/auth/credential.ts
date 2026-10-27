import { getEnv } from '@/lib/env';
import { AppError, forbidden, unauthorized } from '@/lib/errors';
import { log } from '@/lib/log';
import { getStaff } from '@/lib/settings/store';
import type { StaffRoster } from '@/lib/status/types';
import { ADMIN_COOKIE, STAFF_COOKIE, parseAdminCookie, parseCookieHeader, parseStaffCookie, passcodeFingerprint, type StaffSession } from './cookies';
import { csrfOk, type HeaderReader } from './csrf';
import { bearerFromHeader, constantTimeEqual, matchApiToken } from './tokens';

/**
 * Shared auth helpers (SPEC §5). Auth is enforced inside route handlers and server
 * components through these — middleware is not the boundary.
 */

export type Credential =
  | { kind: 'staff'; id: string; name: string }
  | { kind: 'token'; label: string }
  | { kind: 'read_token' };

/** Roster check for a signed staff session: present, active, and `sv` matches `session_version`. */
export function resolveStaffSession(session: StaffSession, roster: StaffRoster): Extract<Credential, { kind: 'staff' }> | null {
  const entry = roster.staff.find((s) => s.id === session.id);
  if (!entry || !entry.active || entry.session_version !== session.sv) return null;
  return { kind: 'staff', id: entry.id, name: entry.name };
}

export async function readCredential(headers: HeaderReader): Promise<Credential | null> {
  const env = getEnv();
  const bearer = bearerFromHeader(headers.get('authorization'));
  if (bearer) {
    const token = matchApiToken(bearer, env.API_TOKENS);
    if (token) return { kind: 'token', label: token.label };
    if (env.READ_TOKEN && constantTimeEqual(bearer, env.READ_TOKEN)) return { kind: 'read_token' };
    return null;
  }
  const cookies = parseCookieHeader(headers.get('cookie'));
  const session = parseStaffCookie(cookies.get(STAFF_COOKIE), env.SESSION_SECRET);
  if (!session) return null;
  return resolveStaffSession(session, await getStaff());
}

/**
 * `readCredential` for server components: when the roster cannot be read (a Shopify
 * failure) the request is logged and treated as having no session, so a page renders its
 * public view with the usual error notice instead of a bare 500. Route handlers keep
 * `readCredential` and answer the documented 502.
 */
export async function readCredentialSafe(headers: HeaderReader): Promise<Credential | null> {
  try {
    return await readCredential(headers);
  } catch (e) {
    log.warn('session check failed — treating the request as anonymous', { detail: e instanceof AppError ? (e.detail ?? e.message) : String(e) });
    return null;
  }
}

/** Writes: staff cookie or API_TOKENS bearer. READ_TOKEN never authorizes writes. */
export async function requireWriter(headers: HeaderReader): Promise<Extract<Credential, { kind: 'staff' | 'token' }>> {
  const cred = await readCredential(headers);
  if (!cred || cred.kind === 'read_token') throw unauthorized();
  if (cred.kind === 'staff' && !csrfOk(headers, getEnv().TRUST_PROXY)) throw forbidden('csrf');
  return cred;
}

/**
 * Reads: public unless READ_TOKEN is set, then any credential is required. A bearer token
 * that matches nothing is refused either way: a mistyped or rotated token must surface as
 * 401, never as a quiet downgrade to the public shape.
 */
export async function requireReader(headers: HeaderReader): Promise<Credential | null> {
  const cred = await readCredential(headers);
  if (!cred && (bearerFromHeader(headers.get('authorization')) || getEnv().READ_TOKEN)) throw unauthorized();
  return cred;
}

/** A valid `trax_admin` cookie that was issued for the passcode currently configured. */
export function isAdmin(headers: HeaderReader): boolean {
  const env = getEnv();
  if (!env.ADMIN_PASSCODE) return false;
  const cookies = parseCookieHeader(headers.get('cookie'));
  const session = parseAdminCookie(cookies.get(ADMIN_COOKIE), env.SESSION_SECRET);
  return session !== null && constantTimeEqual(session.ph, passcodeFingerprint(env.ADMIN_PASSCODE));
}

export function requireAdmin(headers: HeaderReader): void {
  if (!isAdmin(headers)) throw unauthorized('admin_required');
  if (!csrfOk(headers, getEnv().TRUST_PROXY)) throw forbidden('csrf');
}

/**
 * True when HTML pages need a staff login (READ_TOKEN set) and this request has none — or
 * the roster could not be read, in which case nothing can be verified and the page sends the
 * visitor to /login rather than rendering order data.
 */
export async function pageNeedsLogin(headers: HeaderReader): Promise<boolean> {
  if (!getEnv().READ_TOKEN) return false;
  const cred = await readCredentialSafe(headers);
  return !(cred && cred.kind === 'staff');
}
