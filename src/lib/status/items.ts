import type { LineItem, Settings } from './types';

/** Hidden = not shippable, a gift card, or a title matching a settings pattern (literal, case-insensitive). */
export function isHidden(item: Pick<LineItem, 'title' | 'requiresShipping' | 'isGiftCard'>, settings: Pick<Settings, 'hide_items_matching'>): boolean {
  if (!item.requiresShipping || item.isGiftCard) return true;
  const title = item.title.toLowerCase();
  return settings.hide_items_matching.some((p) => p.length > 0 && title.includes(p.toLowerCase()));
}

/** Removed = order edit set the live quantity to 0 (Shopify keeps the line). */
export function isRemoved(item: Pick<LineItem, 'currentQuantity'>): boolean {
  return item.currentQuantity <= 0;
}

export interface Classified {
  visible: LineItem[];
  hidden: LineItem[];
  removed: LineItem[];
}

export function classifyLineItems(lineItems: readonly LineItem[], settings: Pick<Settings, 'hide_items_matching'>): Classified {
  const out: Classified = { visible: [], hidden: [], removed: [] };
  for (const li of lineItems) {
    if (isHidden(li, settings)) out.hidden.push(li);
    else if (isRemoved(li)) out.removed.push(li);
    else out.visible.push(li);
  }
  return out;
}

/**
 * Pill text: title, ` — {variant}` unless "Default Title", ` ×{n}` when the live quantity
 * is above 1, and `(1 of 2)` when two visible lines share title and variant.
 */
export function pillLabel(item: LineItem, visible: readonly LineItem[]): string {
  let label = item.title;
  const variant = item.variantTitle && item.variantTitle !== 'Default Title' ? item.variantTitle : null;
  if (variant) label += ` — ${variant}`;
  if (item.currentQuantity > 1) label += ` ×${item.currentQuantity}`;
  const sameKey = (o: LineItem) =>
    o.title === item.title && (o.variantTitle ?? null) === (item.variantTitle ?? null);
  const twins = visible.filter(sameKey);
  if (twins.length > 1) {
    const sorted = [...twins].sort((a, b) => a.position - b.position);
    const idx = sorted.findIndex((o) => o.id === item.id);
    if (idx >= 0) label += ` (${idx + 1} of ${sorted.length})`;
  }
  return label;
}

/** Custom attributes shown under the pill: keys that do not start with `_`. */
export function visibleAttributes(item: Pick<LineItem, 'customAttributes'>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of item.customAttributes) {
    if (!a.key || a.key.startsWith('_')) continue;
    out[a.key] = a.value ?? '';
  }
  return out;
}

/** `gid://shopify/LineItem/50788056399960` → `50788056399960` (null when not a line item gid). */
export function lineItemIdFromGid(gid: string): string | null {
  const m = /^gid:\/\/shopify\/LineItem\/(\d{1,20})$/.exec(gid);
  return m ? (m[1] ?? null) : null;
}
