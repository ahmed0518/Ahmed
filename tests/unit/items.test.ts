import { describe, expect, it } from 'vitest';
import { classifyLineItems, isHidden, lineItemIdFromGid, pillLabel, visibleAttributes } from '@/lib/status/items';
import { lineItem, settings } from './helpers';

describe('hide rules', () => {
  const s = settings();
  it('hides by requiresShipping, gift card and literal title patterns', () => {
    expect(isHidden(lineItem('1', { title: 'Ring' }), s)).toBe(false);
    expect(isHidden(lineItem('1', { title: 'Ring', requiresShipping: false }), s)).toBe(true);
    expect(isHidden(lineItem('1', { title: 'Gift', isGiftCard: true }), s)).toBe(true);
    expect(isHidden(lineItem('1', { title: '1-Month Silver WARRANTY' }), s)).toBe(true);
    expect(isHidden(lineItem('1', { title: 'Shipping Protection' }), s)).toBe(true);
  });

  it('patterns are literal substrings, never regex', () => {
    const regexy = settings({ hide_items_matching: ['.*', 'ring+'] });
    expect(isHidden(lineItem('1', { title: 'Ring' }), regexy)).toBe(false);
    expect(isHidden(lineItem('1', { title: 'a.*b' }), regexy)).toBe(true);
    expect(isHidden(lineItem('1', { title: 'ring+' }), regexy)).toBe(true);
  });

  it('classifies visible / hidden / removed', () => {
    const c = classifyLineItems(
      [lineItem('1'), lineItem('2', { currentQuantity: 0 }), lineItem('3', { title: 'Warranty' }), lineItem('4', { title: 'Warranty', currentQuantity: 0 })],
      s,
    );
    expect(c.visible.map((i) => i.id)).toEqual(['1']);
    expect(c.removed.map((i) => i.id)).toEqual(['2']);
    expect(c.hidden.map((i) => i.id)).toEqual(['3', '4']);
  });
});

describe('pill label', () => {
  it('adds variant, quantity and (1 of 2) by position', () => {
    const a = lineItem('1', { title: 'Bracelet', variantTitle: 'Yellow Gold / 8 Inches', position: 1 });
    const b = lineItem('2', { title: 'Bracelet', variantTitle: 'Yellow Gold / 8 Inches', position: 3, currentQuantity: 2 });
    const c = lineItem('3', { title: 'Bracelet', variantTitle: 'Default Title', position: 2 });
    const d = lineItem('4', { title: 'Pendant', variantTitle: null, position: 4 });
    const all = [a, b, c, d];
    expect(pillLabel(a, all)).toBe('Bracelet — Yellow Gold / 8 Inches (1 of 2)');
    expect(pillLabel(b, all)).toBe('Bracelet — Yellow Gold / 8 Inches ×2 (2 of 2)');
    expect(pillLabel(c, all)).toBe('Bracelet');
    expect(pillLabel(d, all)).toBe('Pendant');
  });

  it('shows custom attributes without a leading underscore', () => {
    expect(
      visibleAttributes(
        lineItem('1', {
          customAttributes: [
            { key: 'Engraving', value: 'MOM' },
            { key: '_internal', value: 'x' },
            { key: 'Size', value: null },
          ],
        }),
      ),
    ).toEqual({ Engraving: 'MOM', Size: '' });
  });

  it('extracts numeric ids from gids', () => {
    expect(lineItemIdFromGid('gid://shopify/LineItem/50788056399960')).toBe('50788056399960');
    expect(lineItemIdFromGid('gid://shopify/Order/1')).toBeNull();
  });
});
