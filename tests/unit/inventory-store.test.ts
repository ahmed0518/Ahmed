import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MetalSlip, Slip } from '@/lib/inventory/model';
import { FileInventoryStore } from '@/lib/inventory/store-file';
import { PgInventoryStore } from '@/lib/inventory/store-pg';
import type { InventoryStore } from '@/lib/inventory/store-shared';

function slip(id: string, extra: Partial<MetalSlip> = {}): Slip {
  return { id, kind: 'metal', who: 'Chaerin', date: '2026-10-19', note: '', source: 'manual', createdAt: '2026-10-19T12:00:00Z', dust: 2.37, lines: [{ item: '249394', qty: 1, before: 0.4, after: 0.3 }], ...extra };
}

function behaves(name: string, make: () => Promise<{ store: InventoryStore; reopen?: () => InventoryStore }>) {
  describe(name, () => {
    it('upserts, lists, gets, deletes and keeps settings with a read-modify-write', async () => {
      const { store } = await make();
      expect(await store.listSlips()).toEqual([]);
      await store.putSlips([slip('a'), slip('b', { date: '2026-10-20' })]);
      await store.putSlips([slip('a', { dust: 5 })]); // upsert
      const list = await store.listSlips();
      expect(list.map((s) => s.id).sort()).toEqual(['a', 'b']);
      expect((list.find((s) => s.id === 'a') as MetalSlip).dust).toBe(5);
      expect(await store.getSlip('b')).toMatchObject({ id: 'b', date: '2026-10-20' });
      expect(await store.getSlip('zzz')).toBeNull();
      expect(await store.deleteSlip('a')).toBe(true);
      expect(await store.deleteSlip('a')).toBe(false);
      expect((await store.listSlips()).map((s) => s.id)).toEqual(['b']);

      const defaults = await store.getSettings();
      expect(defaults.jewelers).toEqual(['Chaerin', 'Mr. Sim', 'Mr. Kim']);
      const next = await store.updateSettings((s) => ({ ...s, jewelers: ['A', 'B'], access: { jin: { sections: ['diamond'], write: false } } }));
      expect(next.jewelers).toEqual(['A', 'B']);
      expect((await store.getSettings()).access.jin).toEqual({ sections: ['diamond'], write: false });
      expect(await store.updateSettings(() => null)).toMatchObject({ jewelers: ['A', 'B'] });
      // concurrent increments never clobber each other
      await Promise.all([1, 2, 3, 4].map((n) => store.updateSettings((s) => ({ ...s, jewelers: [...s.jewelers, `J${n}`] }))));
      expect((await store.getSettings()).jewelers).toHaveLength(6);
      await store.close();
    });
  });
}

describe('inventory stores', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'trax-inv-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  behaves('file store', async () => ({ store: new FileInventoryStore(path.join(dir, 'a')) }));

  it('file store: persists across instances and skips an unreadable document', async () => {
    const d = path.join(dir, 'b');
    const first = new FileInventoryStore(d);
    await first.putSlips([slip('keep')]);
    await first.updateSettings((s) => ({ ...s, jewelers: ['Only'] }));
    await first.close();
    const file = path.join(d, 'inventory.json');
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { slips: Record<string, unknown> };
    raw.slips.broken = { kind: 'metal', date: 'not a date' };
    writeFileSync(file, JSON.stringify(raw));
    const second = new FileInventoryStore(d);
    expect((await second.listSlips()).map((s) => s.id)).toEqual(['keep']);
    expect((await second.getSettings()).jewelers).toEqual(['Only']);
    await second.putSlips([slip('more')]);
    expect(Object.keys((JSON.parse(readFileSync(file, 'utf8')) as { slips: Record<string, unknown> }).slips)).toEqual(['keep', 'more']);
  });

  let pg: PGlite;
  beforeAll(async () => {
    pg = new PGlite();
    await pg.waitReady;
  });
  afterAll(async () => {
    await pg?.close();
  });
  behaves('postgres store (PGlite)', async () => ({ store: new PgInventoryStore(pg) }));

  it('postgres store: validates rows on the way out', async () => {
    const store = new PgInventoryStore(pg);
    await store.putSlips([slip('good')]);
    await pg.query(`INSERT INTO inventory_slips (id, kind, date, doc) VALUES ('rogue', 'metal', '2026-10-19', '{"kind":"metal","date":"nope"}'::jsonb)`);
    const ids = (await store.listSlips()).map((s) => s.id);
    expect(ids).toContain('good');
    expect(ids).not.toContain('rogue');
  });
});
