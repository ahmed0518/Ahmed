/** The store interface and the validate-on-read helpers shared by both backends (SPEC §14.4). */
import { log } from '@/lib/log';
import { validateInventorySettings, validateSlip, type InventorySettings, type Slip } from './model';

export interface InventoryStore {
  listSlips(): Promise<Slip[]>;
  getSlip(id: string): Promise<Slip | null>;
  /** upsert by id */
  putSlips(slips: readonly Slip[]): Promise<void>;
  deleteSlip(id: string): Promise<boolean>;
  getSettings(): Promise<InventorySettings>;
  /** read-modify-write; the mutator may return null to leave the settings alone */
  updateSettings(mutate: (current: InventorySettings) => InventorySettings | null): Promise<InventorySettings>;
  close(): Promise<void>;
}

/** Validate a stored slip; an unreadable one is logged and dropped rather than crashing the list. */
export function readStoredSlip(raw: unknown, where: string): Slip | null {
  const slip = validateSlip(raw);
  if (!slip) log.warn('inventory slip is unreadable — skipped', { where, id: typeof raw === 'object' && raw !== null ? String((raw as { id?: unknown }).id ?? '') : '' });
  return slip;
}

export function readStoredSettings(raw: unknown, fallback: InventorySettings): InventorySettings {
  if (raw === undefined || raw === null) return fallback;
  const valid = validateInventorySettings(raw);
  if (valid) return valid;
  log.error('inventory settings are invalid — using defaults', {});
  return fallback;
}
