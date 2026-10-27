import { describe, expect, it } from 'vitest';
import { parseDays, parseLineItemId, parseOrderNumber, parsePage, safeNextPath } from '@/lib/validate';

describe('order number parsing', () => {
  it('accepts the three forms', () => {
    expect(parseOrderNumber('251548')).toBe('251548');
    expect(parseOrderNumber('#251548')).toBe('251548');
    expect(parseOrderNumber('Order 251548')).toBe('251548');
    expect(parseOrderNumber('order #251548')).toBe('251548');
    expect(parseOrderNumber('  251548  ')).toBe('251548');
    expect(parseOrderNumber('0251548')).toBe('251548');
  });

  it('rejects anything that is not 1–12 digits', () => {
    for (const bad of ['251548 OR email:x', 'name:*', '251548)', '2515-48', '', '#', 'abc', '1234567890123', '251548\nx', '251548 AND tag:x', '12e3', '-1', '251548 ']) {
      if (bad === '251548 ') continue; // trailing whitespace is trimmed on purpose
      expect(parseOrderNumber(bad), bad).toBeNull();
    }
    expect(parseOrderNumber(251548)).toBeNull();
  });
});

describe('other params', () => {
  it('line item ids', () => {
    expect(parseLineItemId('50788056399960')).toBe('50788056399960');
    expect(parseLineItemId('gid://shopify/LineItem/1')).toBeNull();
    expect(parseLineItemId('123456789012345678901')).toBeNull();
    expect(parseLineItemId('__proto__')).toBeNull();
  });

  it('page and days', () => {
    expect(parsePage(null)).toBe(1);
    expect(parsePage('7')).toBe(7);
    expect(parsePage('0')).toBeNull();
    expect(parsePage('101')).toBeNull();
    expect(parsePage('x')).toBeNull();
    expect(parseDays(null)).toBeUndefined();
    expect(parseDays('3')).toBe(3);
    expect(parseDays('0.5')).toBe(0.5);
    expect(parseDays('366')).toBeNull();
    expect(parseDays('-1')).toBeNull();
    expect(parseDays('Infinity')).toBeNull();
  });

  it('next paths stay same-origin', () => {
    expect(safeNextPath('/orders/1')).toBe('/orders/1');
    expect(safeNextPath('//evil.test')).toBe('/');
    expect(safeNextPath('/\\evil.test')).toBe('/');
    expect(safeNextPath('https://evil.test')).toBe('/');
    expect(safeNextPath(null)).toBe('/');
  });
});
