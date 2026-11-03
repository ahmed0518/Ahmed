/**
 * Pull the four monday.com boards into the inventory store from the command line (a Docker
 * host's cron; Vercel uses the cron in vercel.json instead). `npm run sync:monday -- dust scrap`
 * limits it to those boards. Exit code 1 when any board failed.
 */
import type { SyncBoard } from '../src/lib/inventory/model';
import { loadProjectEnv } from './dotenv';

loadProjectEnv();

async function main(): Promise<void> {
  const { SYNC_BOARDS } = await import('../src/lib/inventory/model');
  const { syncMonday } = await import('../src/lib/inventory/monday');
  const { getInventoryStore } = await import('../src/lib/inventory/store');
  const args = process.argv.slice(2);
  const boards = args.length ? args : [...SYNC_BOARDS];
  for (const b of boards) {
    if (!(SYNC_BOARDS as readonly string[]).includes(b)) {
      process.stderr.write(`unknown board "${b}" — use ${SYNC_BOARDS.join(', ')}\n`);
      process.exit(2);
    }
  }
  const store = getInventoryStore();
  const results = await syncMonday(store, boards as SyncBoard[]);
  await store.close();
  for (const r of results) process.stdout.write(`${r.board}: ${r.ok ? `ok, ${r.written} written, ${r.skipped} skipped` : `FAILED ${r.error ?? ''}`}\n`);
  if (results.some((r) => !r.ok)) process.exit(1);
}

main().catch((e) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
