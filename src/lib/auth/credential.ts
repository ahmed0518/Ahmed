import { getEnv } from '@/lib/env';
import { forbidden, unauthorized } from '@/lib/errors';
import { getStaff } from '@/lib/settings/store';
import type { StaffRoster } from '@/lib/status/types';
import { ADMIN_COOKIE, STAFF_COOKIE, parseAdminCookie, parseCookieHeader, parseStaffCookie, type StaffSession } from './cookies';
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

/** Writes: staff cookie or API_TOKENS bearer. READ_TOKEN never authorizes writes. */
export async function requireWriter(headers: HeaderReader): Promise<Extract<Credential, { kind: 'staff' | 'token' }>> {
  const cred = await readCredential(headers);
  if (!cred || cred.kind === 'read_token') throw unauthorized();
  if (cred.kind === 'staff' && !csrfOk(headers)) throw forbidden('csrf');
  return cred;
}

/** Reads: public unless READ_TOKEN is set, then any credential is required. */
export async function requireReader(headers: HeaderReader): Promise<Credential | null> {
  const cred = await readCredential(headers);
  if (getEnv().READ_TOKEN && !cred) throw unauthorized();
  return cred;
}

export function isAdmin(headers: HeaderReader): boolean {
  const env = getEnv();
  if (!env.ADMIN_PASSCODE) return false;
  const cookies = parseCookieHeader(headers.get('cookie'));
  return parseAdminCookie(cookies.get(ADMIN_COOKIE), env.SESSION_SECRET) !== null;
}

export function requireAdmin(headers: HeaderReader): void {
  if (!isAdmin(headers)) throw unauthorized('admin_required');
  if (!csrfOk(headers)) throw forbidden('csrf');
}

/** True when HTML pages need a staff login (READ_TOKEN set) and this request has none. */
export async function pageNeedsLogin(headers: HeaderReader): Promise<boolean> {
  if (!getEnv().READ_TOKEN) return false;
  const cred = await readCredential(headers);
  return !(cred && cred.kind === 'staff');
}
