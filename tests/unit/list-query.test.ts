import { describe, expect, it } from 'vitest';
import { withOpenFilter } from '@/lib/orders/service';

describe('watch query open filter (SPEC §4.2)', () => {
  it('appends status:open unless the exact unnegated term is already there', () => {
    expect(withOpenFilter('tag:custom-item-order')).toBe('(tag:custom-item-order) status:open');
    expect(withOpenFilter('tag:x fulfillment_status:unshipped')).toBe('(tag:x fulfillment_status:unshipped) status:open');
    expect(withOpenFilter('tag:custom-item-order status:open fulfillment_status:unshipped')).toBe('tag:custom-item-order status:open fulfillment_status:unshipped');
    expect(withOpenFilter('(tag:a OR tag:b) AND status:open')).toBe('(tag:a OR tag:b) AND status:open');
    expect(withOpenFilter('STATUS:OPEN tag:x')).toBe('STATUS:OPEN tag:x');
    expect(withOpenFilter('  ')).toBe('');
  });

  it('a negated or different status term does not count — archived orders must still be excluded', () => {
    expect(withOpenFilter('tag:x -status:cancelled')).toBe('(tag:x -status:cancelled) status:open');
    expect(withOpenFilter('tag:x NOT status:cancelled')).toBe('(tag:x NOT status:cancelled) status:open');
    expect(withOpenFilter('tag:x -status:open')).toBe('(tag:x -status:open) status:open');
    expect(withOpenFilter('tag:x status:closed')).toBe('(tag:x status:closed) status:open');
    expect(withOpenFilter('tag:x status:opened')).toBe('(tag:x status:opened) status:open');
    expect(withOpenFilter('financial_status:open')).toBe('(financial_status:open) status:open');
  });
});
