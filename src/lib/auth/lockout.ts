import { AppError, tooManyRequests } from '@/lib/errors';
import { log } from '@/lib/log';
import { updateSettings, updateStaff } from '@/lib/settings/store';
import type { StaffEntry } from '@/lib/status/types';
import { isLocked, lockRemainingSeconds, recordFailure, recordSuccess, type LockState } from './pin';

/**
 * Persisted lockout, fail closed (SPEC §5). The attempt is recorded — inside the CAS
 * mutator, from the fresh entry, serialized per instance — BEFORE the secret is verified,
 * so N racing guesses cost N counted attempts and the lock lands on the 5th no matter how
 * many requests arrive at once. A locked name is refused without verifying anything, and
 * when the attempt cannot be recorded (CAS exhausted) the login is refused as well.
 */

export function lockedError(state: LockState, now: Date, what: string): AppError {
  return new AppError(429, 'locked', `Too many wrong ${what} — try again later`, { retryAfter: lockRemainingSeconds(state, now) });
}

/** One more attempt on a lock state: throws 429 `locked` while locked, otherwise counts it. */
export function claimAttempt(state: LockState, now: Date, what: string): LockState {
  if (isLocked(state, now)) throw lockedError(state, now, what);
  return recordFailure(state, now);
}

function failClosed(e: unknown): never {
  if (e instanceof AppError && e.status === 409) throw tooManyRequests(5);
  throw e;
}

/**
 * Record a login attempt for `id`. Returns the roster entry with the attempt counted (its
 * `pin_hash` and `session_version` as stored), or null for an unknown or inactive name —
 * nothing is written in that case.
 */
export async function claimStaffAttempt(id: string, now: Date): Promise<StaffEntry | null> {
  const found: { entry: StaffEntry | null } = { entry: null };
  try {
    await updateStaff((roster) => {
      const entry = roster.staff.find((s) => s.id === id);
      if (!entry || !entry.active) return null;
      const claimed = { ...entry, ...claimAttempt(entry, now, 'PINs') };
      found.entry = claimed;
      return { ...roster, staff: roster.staff.map((s) => (s.id === id ? claimed : s)) };
    });
  } catch (e) {
    failClosed(e);
  }
  return found.entry;
}

/** A verified login resets the counter. Logged, never thrown: the PIN was right. */
export async function recordStaffSuccess(id: string): Promise<void> {
  try {
    await updateStaff((roster) => ({ ...roster, staff: roster.staff.map((s) => (s.id === id ? { ...s, ...recordSuccess() } : s)) }));
  } catch (e) {
    log.error('could not reset the lockout counter after a successful login', { name: id, detail: e instanceof AppError ? (e.detail ?? e.message) : String(e) });
  }
}

/** Record an admin passcode attempt in `settings`; returns the counted state. */
export async function claimAdminAttempt(now: Date): Promise<LockState> {
  const found: { state: LockState | null } = { state: null };
  try {
    await updateSettings((settings) => {
      const claimed = claimAttempt({ failed_attempts: settings.admin_failed_attempts, locked_until: settings.admin_locked_until }, now, 'passcodes');
      found.state = claimed;
      return { ...settings, admin_failed_attempts: claimed.failed_attempts, admin_locked_until: claimed.locked_until };
    });
  } catch (e) {
    failClosed(e);
  }
  return found.state ?? { failed_attempts: 0, locked_until: null };
}

export async function recordAdminSuccess(): Promise<void> {
  try {
    await updateSettings((settings) => ({ ...settings, admin_failed_attempts: 0, admin_locked_until: null }));
  } catch (e) {
    log.error('could not reset the admin lockout counter after a successful login', { detail: e instanceof AppError ? (e.detail ?? e.message) : String(e) });
  }
}
