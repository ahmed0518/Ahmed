import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { defaultInventorySettings, type InventorySettings, type Slip } from './model';
import { readStoredSettings, readStoredSlip, type InventoryStore } from './store-shared';

/**
 * One JSON file, `<dir>/inventory.json`: `{ v: 1, slips: { id: slip }, settings }`. Loaded
 * once, kept in memory, written atomically (temp file + rename) after every change; writes are
 * serialized per instance. Meant for one server process on a volume — Postgres is the choice
 * when several instances run.
 */
interface FileShape {
  v: 1;
  slips: Record<string, unknown>;
  settings?: unknown;
}

export class FileInventoryStore implements InventoryStore {
  private readonly file: string;
  private slips: Map<string, Slip> | null = null;
  private settings: InventorySettings | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(dir: string) {
    this.file = path.join(dir, 'inventory.json');
  }

  private load(): void {
    if (this.slips) return;
    const slips = new Map<string, Slip>();
    let settings = defaultInventorySettings();
    let raw: FileShape | null = null;
    try {
      raw = JSON.parse(readFileSync(this.file, 'utf8')) as FileShape;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    if (raw && typeof raw === 'object') {
      for (const [id, doc] of Object.entries(raw.slips ?? {})) {
        const slip = readStoredSlip({ ...(doc as object), id }, this.file);
        if (slip) slips.set(slip.id, slip);
      }
      settings = readStoredSettings(raw.settings, settings);
    }
    this.slips = slips;
    this.settings = settings;
  }

  private serialized<T>(fn: () => T): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private flush(): void {
    const slips: Record<string, Slip> = {};
    for (const [id, s] of [...(this.slips ?? new Map<string, Slip>())].sort(([a], [b]) => a.localeCompare(b))) slips[id] = s;
    const body: FileShape = { v: 1, slips, settings: this.settings ?? defaultInventorySettings() };
    mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(body, null, 1));
    renameSync(tmp, this.file);
  }

  async listSlips(): Promise<Slip[]> {
    this.load();
    return [...(this.slips?.values() ?? [])].map((s) => structuredClone(s));
  }

  async getSlip(id: string): Promise<Slip | null> {
    this.load();
    const s = this.slips?.get(id);
    return s ? structuredClone(s) : null;
  }

  putSlips(slips: readonly Slip[]): Promise<void> {
    return this.serialized(() => {
      this.load();
      for (const s of slips) this.slips?.set(s.id, structuredClone(s));
      this.flush();
    });
  }

  deleteSlip(id: string): Promise<boolean> {
    return this.serialized(() => {
      this.load();
      const had = this.slips?.delete(id) ?? false;
      if (had) this.flush();
      return had;
    });
  }

  async getSettings(): Promise<InventorySettings> {
    this.load();
    return structuredClone(this.settings ?? defaultInventorySettings());
  }

  updateSettings(mutate: (current: InventorySettings) => InventorySettings | null): Promise<InventorySettings> {
    return this.serialized(() => {
      this.load();
      const current = this.settings ?? defaultInventorySettings();
      const next = mutate(structuredClone(current));
      if (next === null) return structuredClone(current);
      this.settings = next;
      this.flush();
      return structuredClone(next);
    });
  }

  async close(): Promise<void> {
    await this.queue;
  }
}
