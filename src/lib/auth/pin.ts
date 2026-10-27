import { createHash, timingSafeEqual } from 'node:crypto';
import { formatTimestamp, parseTimestamp } from '@/lib/time';

/** PIN hashing and the persisted lockout state machine (SPEC §5). */

export const PIN_RE = /^\d{4,8}$/;
export const LOCK_THRESHOLD = 5;
export const LOCK_BASE_MS = 15 * 60_000;
export const LOCK_MAX_MS = 24 * 3600_000;

export function hashPin(pepper: string, staffId: string, pin: string): string {
  return createHash('sha256').update(`${pepper}:${staffId}:${pin}`).digest('hex');
}

export function verifyPin(pepper: string, staffId: string, pin: string, storedHash: string | null): boolean {
  if (!storedHash || !/^[0-9a-f]{64}$/.test(storedHash)) return false;
  const expected = Buffer.from(hashPin(pepper, staffId, pin), 'hex');
  const given = Buffer.from(storedHash, 'hex');
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export interface LockState {
  failed_attempts: number;
  locked_until: string | null;
}

export function isLocked(state: LockState, now: Date): boolean {
  const until = parseTimestamp(state.locked_until);
  return until !== null && until.getTime() > now.getTime();
}

export function lockRemainingSeconds(state: LockState, now: Date): number {
  const until = parseTimestamp(state.locked_until);
  if (!until) return 0;
  return Math.max(0, Math.ceil((until.getTime() - now.getTime()) / 1000));
}

/**
 * One more failure: after every 5th consecutive failure the name is locked, 15 minutes the
 * first time and doubling for each further streak, capped at 24 hours.
 */
export function recordFailure(state: LockState, now: Date): LockState {
  const failed = state.failed_attempts + 1;
  if (failed % LOCK_THRESHOLD !== 0) return { failed_attempts: failed, locked_until: state.locked_until };
  const streak = failed / LOCK_THRESHOLD; // 1, 2, 3 …
  const duration = Math.min(LOCK_BASE_MS * 2 ** (streak - 1), LOCK_MAX_MS);
  return { failed_attempts: failed, locked_until: formatTimestamp(new Date(now.getTime() + duration)) };
}

export function recordSuccess(): LockState {
  return { failed_attempts: 0, locked_until: null };
}

export const clearLock = recordSuccess;
