/**
 * Import slips into the configured inventory store (SPEC §14.9). Accepts the artifact export
 * (`{ docs: { id: slip } }`), this app's file-store shape (`{ slips: { id: slip } }`) or a
 * plain array of slips with ids. Upserts by id, so running it twice changes nothing.
 *
 *   npm run import:inventory -- data/trax-inventory-2026-11-03.json
 */
import { readFileSync } from 'node:fs';
import { loadProjectEnv } from './dotenv';

loadProjectEnv();

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file) {
    process.stderr.write('usage: npm run import:inventory -- <file.json>\n');
    process.exit(2);
  }
  const { validateSlip } = await import('../src/lib/inventory/model');
  const { getInventoryStore } = await import('../src/lib/inventory/store');
  const raw = JSON.parse(readFileSync(file, 'utf8')) as { docs?: Record<string, unknown>; slips?: Record<string, unknown> } | unknown[];
  const entries: [string, unknown][] = Array.isArray(raw)
    ? raw.map((d) => [String((d as { id?: unknown }).id ?? ''), d])
    : Object.entries(raw.docs ?? raw.slips ?? {});
  const store = getInventoryStore();
  const ok = [];
  const bad: string[] = [];
  for (const [id, doc] of entries) {
    const slip = validateSlip({ ...(doc as object), id });
    if (slip) ok.push(slip);
    else bad.push(id || '(no id)');
  }
  await store.putSlips(ok);
  await store.close();
  process.stdout.write(`imported ${ok.length} slips${bad.length ? `; ${bad.length} invalid: ${bad.join(', ')}` : ''}\n`);
  if (bad.length) process.exit(1);
}

main().catch((e) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
