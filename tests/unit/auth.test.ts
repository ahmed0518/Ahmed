import { describe, expect, it } from 'vitest';
import { parseAdminCookie, parseStaffCookie, passcodeFingerprint, serializeCookie, signCookie, type AdminSession } from '@/lib/auth/cookies';
import { resolveStaffSession } from '@/lib/auth/credential';
import { csrfOk, clientIp } from '@/lib/auth/csrf';
import { claimAttempt } from '@/lib/auth/lockout';
import { LOCK_BASE_MS, LOCK_MAX_MS, hashPin, isLocked, recordFailure, recordSuccess, verifyPin, type LockState } from '@/lib/auth/pin';
import { AppError } from '@/lib/errors';
import { RateLimiter } from '@/lib/auth/ratelimit';
import { bearerFromHeader, constantTimeEqual, matchApiToken } from '@/lib/auth/tokens';
import { parseApiTokens } from '@/lib/env';

const SECRET = 'a'.repeat(64);
const PEPPER = 'b'.repeat(64);

describe('PIN hash and verify', () => {
  it('is deterministic, peppered and bound to the staff id', () => {
    const h = hashPin(PEPPER, 'ahmed', '1234');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashPin(PEPPER, 'ahmed', '1234')).toBe(h);
    expect(hashPin('c'.repeat(64), 'ahmed', '1234')).not.toBe(h);
    expect(hashPin(PEPPER, 'igor', '1234')).not.toBe(h);
    expect(verifyPin(PEPPER, 'ahmed', '1234', h)).toBe(true);
    expect(verifyPin(PEPPER, 'ahmed', '1235', h)).toBe(false);
    expect(verifyPin(PEPPER, 'ahmed', '1234', null)).toBe(false);
    expect(verifyPin(PEPPER, 'ahmed', '1234', 'nothex')).toBe(false);
  });
});

describe('lockout state machine', () => {
  const t0 = new Date('2026-10-27T12:00:00Z');
  const at = (ms: number) => new Date(t0.getTime() + ms);

  it('locks on the 5th consecutive failure for 15 minutes, success resets', () => {
    let s: LockState = { failed_attempts: 0, locked_until: null };
    for (let i = 0; i < 4; i++) s = recordFailure(s, t0);
    expect(s.failed_attempts).toBe(4);
    expect(isLocked(s, t0)).toBe(false);
    s = recordFailure(s, t0);
    expect(s.failed_attempts).toBe(5);
    expect(isLocked(s, t0)).toBe(true);
    expect(isLocked(s, at(LOCK_BASE_MS - 1000))).toBe(true);
    expect(isLocked(s, at(LOCK_BASE_MS + 1000))).toBe(false);
    s = recordSuccess();
    expect(s).toEqual({ failed_attempts: 0, locked_until: null });
  });

  it('doubles for each further streak and caps at 24 h', () => {
    let s: LockState = { failed_attempts: 0, locked_until: null };
    for (let i = 0; i < 10; i++) s = recordFailure(s, t0);
    expect(new Date(s.locked_until!).getTime() - t0.getTime()).toBe(LOCK_BASE_MS * 2);
    for (let i = 0; i < 5; i++) s = recordFailure(s, t0);
    expect(new Date(s.locked_until!).getTime() - t0.getTime()).toBe(LOCK_BASE_MS * 4);
    for (let i = 0; i < 100; i++) s = recordFailure(s, t0);
    expect(new Date(s.locked_until!).getTime() - t0.getTime()).toBe(LOCK_MAX_MS);
  });

  it('claimAttempt counts before anything is verified and refuses a locked name with 429', () => {
    let s: LockState = { failed_attempts: 0, locked_until: null };
    for (let i = 0; i < 5; i++) s = claimAttempt(s, t0, 'PINs');
    expect(s.failed_attempts).toBe(5);
    expect(isLocked(s, t0)).toBe(true);
    const refused = (() => {
      try {
        claimAttempt(s, at(1000), 'PINs');
        return null;
      } catch (e) {
        return e;
      }
    })();
    expect(refused).toBeInstanceOf(AppError);
    expect(refused).toMatchObject({ status: 429, code: 'locked' });
    expect((refused as AppError).retryAfter).toBeGreaterThan(0);
    // refused attempts are not counted: the state is unchanged
    expect(s.failed_attempts).toBe(5);
    // after the lock expires the next attempt counts again
    expect(claimAttempt(s, at(LOCK_BASE_MS + 1000), 'PINs').failed_attempts).toBe(6);
  });
});

describe('signed cookies', () => {
  const now = new Date('2026-10-27T12:00:00Z');
  const exp = Math.floor(now.getTime() / 1000) + 3600;

  it('round-trips a staff session', () => {
    const v = signCookie({ t: 'staff', id: 'ahmed', name: 'Ahmed', sv: 1, exp }, SECRET);
    expect(v).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(parseStaffCookie(v, SECRET, now)).toEqual({ t: 'staff', id: 'ahmed', name: 'Ahmed', sv: 1, exp });
  });

  it('rejects expiry, tampering, the wrong secret and the wrong type', () => {
    const v = signCookie({ t: 'staff', id: 'ahmed', name: 'Ahmed', sv: 1, exp }, SECRET);
    expect(parseStaffCookie(v, SECRET, new Date((exp + 1) * 1000))).toBeNull();
    expect(parseStaffCookie(v, 'c'.repeat(64), now)).toBeNull();
    const [body, sig] = v.split('.') as [string, string];
    const tampered = Buffer.from(JSON.stringify({ t: 'staff', id: 'igor', name: 'Igor', sv: 1, exp })).toString('base64url');
    expect(parseStaffCookie(`${tampered}.${sig}`, SECRET, now)).toBeNull();
    expect(parseStaffCookie(`${body}.${sig.slice(0, -2)}xx`, SECRET, now)).toBeNull();
    expect(parseStaffCookie('garbage', SECRET, now)).toBeNull();
    const ph = passcodeFingerprint('correct horse battery staple');
    expect(ph).toMatch(/^[0-9a-f]{16}$/);
    expect(passcodeFingerprint('another passcode')).not.toBe(ph);
    const admin = signCookie({ t: 'admin', exp, ph }, SECRET);
    expect(parseStaffCookie(admin, SECRET, now)).toBeNull();
    expect(parseAdminCookie(admin, SECRET, now)).toEqual({ t: 'admin', exp, ph });
    expect(parseAdminCookie(v, SECRET, now)).toBeNull();
    // an admin cookie without the passcode fingerprint is not accepted
    const legacy = signCookie({ t: 'admin', exp } as unknown as AdminSession, SECRET);
    expect(parseAdminCookie(legacy, SECRET, now)).toBeNull();
  });

  it('a session_version bump logs the session out; inactive staff too', () => {
    const session = { t: 'staff' as const, id: 'ahmed', name: 'Ahmed', sv: 1, exp };
    const member = { id: 'ahmed', name: 'Ahmed', pin_hash: null, active: true, session_version: 1, failed_attempts: 0, locked_until: null };
    expect(resolveStaffSession(session, { v: 1, staff: [member] })).toEqual({ kind: 'staff', id: 'ahmed', name: 'Ahmed' });
    expect(resolveStaffSession(session, { v: 1, staff: [{ ...member, session_version: 2 }] })).toBeNull();
    expect(resolveStaffSession(session, { v: 1, staff: [{ ...member, active: false }] })).toBeNull();
    expect(resolveStaffSession(session, { v: 1, staff: [] })).toBeNull();
  });

  it('serializes with the required attributes', () => {
    expect(serializeCookie('trax_staff', 'v', { maxAge: 10, secure: true })).toBe('trax_staff=v; Path=/; HttpOnly; SameSite=Lax; Max-Age=10; Secure');
    expect(serializeCookie('trax_staff', 'v', { maxAge: 10, secure: false })).not.toContain('Secure');
  });
});

describe('tokens', () => {
  it('parses label:token pairs and validates them', () => {
    const ok = parseApiTokens('claude:' + 'x'.repeat(32) + ', maks-ai:' + 'y'.repeat(40));
    expect(ok.problems).toEqual([]);
    expect(ok.tokens.map((t) => t.label)).toEqual(['claude', 'maks-ai']);
    expect(parseApiTokens('claude:short').problems.length).toBeGreaterThan(0);
    expect(parseApiTokens('nocolon').problems.length).toBeGreaterThan(0);
    expect(parseApiTokens('a:' + 'x'.repeat(32) + ',a:' + 'y'.repeat(32)).problems.length).toBeGreaterThan(0);
  });

  it('compares in constant time and matches the right label', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
    const tokens = [
      { label: 'claude', token: 'x'.repeat(32) },
      { label: 'maks-ai', token: 'y'.repeat(32) },
    ];
    expect(matchApiToken('y'.repeat(32), tokens)?.label).toBe('maks-ai');
    expect(matchApiToken('z'.repeat(32), tokens)).toBeNull();
    expect(bearerFromHeader('Bearer abc')).toBe('abc');
    expect(bearerFromHeader('bearer   abc ')).toBe('abc');
    expect(bearerFromHeader('Basic abc')).toBeNull();
    expect(bearerFromHeader(null)).toBeNull();
  });
});

describe('csrf and client ip', () => {
  const h = (map: Record<string, string>) => ({ get: (n: string) => map[n.toLowerCase()] ?? null });
  it('accepts same-origin and none, rejects cross-site, falls back to Origin', () => {
    expect(csrfOk(h({ 'sec-fetch-site': 'same-origin' }))).toBe(true);
    expect(csrfOk(h({ 'sec-fetch-site': 'none' }))).toBe(true);
    expect(csrfOk(h({ 'sec-fetch-site': 'cross-site', origin: 'https://app.test' }))).toBe(false);
    expect(csrfOk(h({ origin: 'https://app.test', host: 'app.test' }))).toBe(true);
    expect(csrfOk(h({ origin: 'https://evil.test', host: 'app.test' }))).toBe(false);
    expect(csrfOk(h({ host: 'app.test' }))).toBe(false);
  });

  it('believes x-forwarded-host for the Origin fallback only behind a trusted proxy', () => {
    const forwarded = h({ origin: 'https://app.test', 'x-forwarded-host': 'app.test', host: 'internal' });
    expect(csrfOk(forwarded)).toBe(false);
    expect(csrfOk(forwarded, 'none')).toBe(false);
    expect(csrfOk(forwarded, 'forwarded')).toBe(true);
    expect(csrfOk(forwarded, 'vercel')).toBe(true);
    // a client cannot pick the host it is compared against when nothing is trusted
    expect(csrfOk(h({ origin: 'http://evil.test', 'x-forwarded-host': 'evil.test', host: 'app.test' }), 'none')).toBe(false);
  });

  it('client ip: nothing is trusted by default, platform headers on Vercel, the proxy-appended hop behind one proxy', () => {
    const spoof = h({ 'x-real-ip': '1.2.3.4', 'x-vercel-forwarded-for': '5.6.7.8', 'x-forwarded-for': '9.9.9.9, 10.0.0.1' });
    expect(clientIp(spoof, 'none')).toBe('unknown');
    expect(clientIp(h({}), 'none')).toBe('unknown');
    expect(clientIp(spoof, 'vercel')).toBe('1.2.3.4');
    expect(clientIp(h({ 'x-vercel-forwarded-for': '5.6.7.8', 'x-forwarded-for': '9.9.9.9' }), 'vercel')).toBe('5.6.7.8');
    expect(clientIp(h({ 'x-forwarded-for': '9.9.9.9' }), 'vercel')).toBe('unknown');
    // behind one reverse proxy the last entry is the one the proxy appended; x-real-ip is ignored
    expect(clientIp(spoof, 'forwarded')).toBe('10.0.0.1');
    expect(clientIp(h({ 'x-forwarded-for': '9.9.9.9' }), 'forwarded')).toBe('9.9.9.9');
    expect(clientIp(h({ 'x-real-ip': '1.2.3.4' }), 'forwarded')).toBe('unknown');
  });
});

describe('rate limiter', () => {
  it('allows the limit then answers retryAfter', () => {
    const l = new RateLimiter(3, 60_000);
    const t = 1_000_000;
    expect(l.check('a', t).ok).toBe(true);
    expect(l.check('a', t + 1).ok).toBe(true);
    expect(l.check('a', t + 2).ok).toBe(true);
    const r = l.check('a', t + 3);
    expect(r.ok).toBe(false);
    expect(r.retryAfter).toBeGreaterThan(0);
    expect(l.check('b', t + 3).ok).toBe(true);
    expect(l.check('a', t + 60_001).ok).toBe(true);
  });
});
