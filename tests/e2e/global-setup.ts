/**
 * Seeds the inventory file store with the exported records before the app servers start
 * (`.e2e-inventory/inventory.json`, the file-store shape). Every spec can add and delete
 * slips of its own; the 93 imported ones stay.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { INVENTORY_DIR } from '../../playwright.config';

export default function globalSetup(): void {
  const raw = JSON.parse(readFileSync(path.join(__dirname, '..', '..', 'data', 'trax-inventory-2026-11-03.json'), 'utf8')) as { docs: Record<string, unknown> };
  rmSync(INVENTORY_DIR, { recursive: true, force: true });
  mkdirSync(INVENTORY_DIR, { recursive: true });
  writeFileSync(path.join(INVENTORY_DIR, 'inventory.json'), JSON.stringify({ v: 1, slips: raw.docs, settings: { v: 1, jewelers: ['Chaerin', 'Mr. Sim', 'Mr. Kim'], access: {}, scrap_since: '2026-09-23', last_sync: {} } }));
}
