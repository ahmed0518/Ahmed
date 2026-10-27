import { defaultSettings } from '@/lib/settings/model';
import type { HistoryEntry, ItemEntry, ItemStatus, LineItem, Settings } from '@/lib/status/types';
import { createItems } from '@/lib/status/types';

export const TZ = 'America/New_York';

export function settings(overrides: Partial<Settings> = {}): Settings {
  return { ...defaultSettings(), ...overrides };
}

export function lineItem(id: string, overrides: Partial<LineItem> = {}): LineItem {
  return {
    id,
    title: `Item ${id}`,
    variantTitle: null,
    sku: null,
    quantity: 1,
    currentQuantity: 1,
    requiresShipping: true,
    isGiftCard: false,
    customAttributes: [],
    position: 1,
    ...overrides,
  };
}

export function entry(status: string | null, updatedAt: string, by = 'Ahmed', history: HistoryEntry[] = []): ItemEntry {
  return {
    title: 'Thing',
    status,
    updated_at: updatedAt,
    updated_by: by,
    source: 'web',
    via: `web:${by}`,
    history: history.length ? history : [{ kind: status === null ? 'clear' : 'set', status, at: updatedAt, by, source: 'web', via: `web:${by}`, note: '' }],
  };
}

export function itemStatus(items: Record<string, ItemEntry>, visibleIds?: string[]): ItemStatus {
  const map = createItems();
  for (const [k, v] of Object.entries(items)) map[k] = v;
  const out: ItemStatus = { v: 1, items: map };
  if (visibleIds) out.visible_ids = visibleIds;
  return out;
}

/** A UTC instant from a New York local time (EDT in October: UTC-4). */
export function ny(dateTime: string): Date {
  return new Date(`${dateTime}-04:00`);
}
