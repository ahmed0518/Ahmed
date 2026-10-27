import { describe, expect, it } from 'vitest';
import { cleanBy, parseDays, parseLineItemId, parseOrderNumber, parsePage, safeNextPath } from '@/lib/validate';

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

  it('`by` is cleaned and refused over 60 characters, never cut', () => {
    expect(cleanBy('  Maks  ')).toBe('Maks');
    expect(cleanBy('Ma\u0000ks\n')).toBe('Maks');
    expect(cleanBy('A'.repeat(60))).toBe('A'.repeat(60));
    expect(cleanBy('A'.repeat(61))).toBeNull();
    expect(cleanBy('')).toBeNull();
    expect(cleanBy('   ')).toBeNull();
    expect(cleanBy(42)).toBeNull();
  });

  it('next paths stay same-origin', () => {
    expect(safeNextPath('/orders/1')).toBe('/orders/1');
    expect(safeNextPath('/orders/251600')).toBe('/orders/251600');
    expect(safeNextPath('/orders/1?x=1#h')).toBe('/orders/1?x=1#h');
    expect(safeNextPath('/')).toBe('/');
    expect(safeNextPath('//evil.test')).toBe('/');
    expect(safeNextPath('/\\evil.test')).toBe('/');
    expect(safeNextPath('https://evil.test')).toBe('/');
    expect(safeNextPath('http://trax.invalid/orders/1')).toBe('/');
    expect(safeNextPath(null)).toBe('/');
    expect(safeNextPath('')).toBe('/');
    expect(safeNextPath('orders/1')).toBe('/');
    expect(safeNextPath(`/${'a'.repeat(300)}`)).toBe('/');
  });

  it('next paths cannot smuggle another host past the browser URL parser', () => {
    // browsers strip tab / newline before parsing, so these become //evil.test
    expect(safeNextPath('/\t/evil.test')).toBe('/');
    expect(safeNextPath('/\n/evil.test')).toBe('/');
    expect(safeNextPath('/\r\\evil.test')).toBe('/');
    expect(safeNextPath('/\u0000/evil.test')).toBe('/');
    // dot segments normalise to a protocol-relative URL
    expect(safeNextPath('/.//evil.test')).toBe('/');
    expect(safeNextPath('/./\\evil.test')).toBe('/');
    expect(safeNextPath('/..//evil.test')).toBe('/');
    expect(safeNextPath('/a/..//evil.test')).toBe('/');
    expect(safeNextPath('/ /evil.test')).toBe('/');
    // percent-encoded slashes stay a same-origin path
    expect(safeNextPath('/%2F%2Fevil.test')).toBe('/%2F%2Fevil.test');
  });
});
