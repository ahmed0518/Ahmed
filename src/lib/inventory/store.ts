/**
 * Where slips live (SPEC §14.4). Two backends behind one small interface: Postgres
 * (`INVENTORY_DATABASE_URL`, for Vercel) or a JSON file in `INVENTORY_DATA_DIR` (a Docker
 * volume, local dev, the e2e run). Every document is validated on the way in and out, so a
 * hand-edited file or a foreign row never crashes a page.
 */
import { getEnv } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { FileInventoryStore } from './store-file';
import { PgInventoryStore } from './store-pg';
import type { InventoryStore } from './store-shared';

export type { InventoryStore } from './store-shared';

let cached: InventoryStore | null = null;

export function inventoryEnabled(): boolean {
  const env = getEnv();
  return env.INVENTORY_DATABASE_URL !== null || env.INVENTORY_DATA_DIR !== null;
}

/** The configured store, or 404 `inventory_disabled` when neither variable is set. */
export function getInventoryStore(): InventoryStore {
  if (cached) return cached;
  const env = getEnv();
  if (env.INVENTORY_DATABASE_URL) cached = new PgInventoryStore(env.INVENTORY_DATABASE_URL);
  else if (env.INVENTORY_DATA_DIR) cached = new FileInventoryStore(env.INVENTORY_DATA_DIR);
  else throw new AppError(404, 'inventory_disabled', 'Inventory is not configured');
  return cached;
}

/** Tests only. */
export function resetInventoryStore(): void {
  cached = null;
}
