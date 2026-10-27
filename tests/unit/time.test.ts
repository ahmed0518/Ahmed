import { describe, expect, it } from 'vitest';
import { businessDaysSince, daysSince, formatAbsolute, formatMonD, formatTimestamp, parseTimestamp, relativeDays } from '@/lib/time';
import { TZ, ny } from './helpers';

describe('timestamp format', () => {
  it('writes seconds, no milliseconds, UTC', () => {
    expect(formatTimestamp(new Date('2026-10-27T15:12:03.456Z'))).toBe('2026-10-27T15:12:03Z');
  });

  it('parses only the exact storage format', () => {
    expect(parseTimestamp('2026-10-27T15:12:03Z')?.toISOString()).toBe('2026-10-27T15:12:03.000Z');
    expect(parseTimestamp('2026-10-27T15:12:03.000Z')).toBeNull();
    expect(parseTimestamp('2026-10-27T15:12:03+00:00')).toBeNull();
    expect(parseTimestamp('2026-02-30T00:00:00Z')).toBeNull();
    expect(parseTimestamp(123)).toBeNull();
  });
});

describe('business days', () => {
  const monToFri = [1, 2, 3, 4, 5];

  it('Friday 16:00 → Monday 10:00 is 1', () => {
    expect(businessDaysSince(ny('2026-10-23T16:00:00'), ny('2026-10-26T10:00:00'), monToFri, TZ)).toBe(1);
  });

  it('same day is 0, next work day is 1', () => {
    expect(businessDaysSince(ny('2026-10-26T09:00:00'), ny('2026-10-26T18:00:00'), monToFri, TZ)).toBe(0);
    expect(businessDaysSince(ny('2026-10-26T09:00:00'), ny('2026-10-27T08:00:00'), monToFri, TZ)).toBe(1);
  });

  it('counts only work days across a week and more', () => {
    expect(businessDaysSince(ny('2026-10-19T12:00:00'), ny('2026-10-26T12:00:00'), monToFri, TZ)).toBe(5);
    expect(businessDaysSince(ny('2026-10-19T12:00:00'), ny('2026-11-02T12:00:00'), monToFri, TZ)).toBe(10);
    expect(businessDaysSince(ny('2026-10-19T12:00:00'), ny('2026-11-04T12:00:00'), monToFri, TZ)).toBe(12);
  });

  it('respects the configured work days (six-day week)', () => {
    expect(businessDaysSince(ny('2026-10-23T16:00:00'), ny('2026-10-26T10:00:00'), [1, 2, 3, 4, 5, 6], TZ)).toBe(2);
  });

  it('uses New York dates, not UTC dates', () => {
    // 23:30 New York on Friday is 03:30 UTC Saturday; Saturday 01:00 NY is still the same civil weekend
    expect(businessDaysSince(ny('2026-10-23T23:30:00'), ny('2026-10-24T01:00:00'), monToFri, TZ)).toBe(0);
  });

  it('never goes negative', () => {
    expect(businessDaysSince(ny('2026-10-27T10:00:00'), ny('2026-10-20T10:00:00'), monToFri, TZ)).toBe(0);
  });
});

describe('display', () => {
  it('days since has one decimal', () => {
    expect(daysSince(new Date('2026-10-22T14:00:00Z'), new Date('2026-10-27T16:24:00Z'))).toBe(5.1);
  });

  it('absolute times in New York, year only when different', () => {
    const now = new Date('2026-10-27T20:00:00Z');
    expect(formatAbsolute(new Date('2026-10-27T19:12:03Z'), TZ, now)).toBe('Oct 27, 3:12 PM');
    expect(formatAbsolute(new Date('2025-12-31T23:30:00Z'), TZ, now)).toBe('Dec 31, 2025, 6:30 PM');
    expect(formatMonD(new Date('2026-10-27T19:12:03Z'), TZ, now)).toBe('Oct 27');
  });

  it('relative labels', () => {
    const now = ny('2026-10-27T10:00:00');
    expect(relativeDays(ny('2026-10-27T01:00:00'), now, TZ)).toBe('today');
    expect(relativeDays(ny('2026-10-26T23:00:00'), now, TZ)).toBe('yesterday');
    expect(relativeDays(ny('2026-10-24T09:00:00'), now, TZ)).toBe('3 days ago');
    expect(relativeDays(ny('2026-10-01T09:00:00'), now, TZ)).toBe('Oct 1');
  });
});
