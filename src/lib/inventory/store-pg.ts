import { Pool } from 'pg';
import { conflict } from '@/lib/errors';
import { log } from '@/lib/log';
import { defaultInventorySettings, type InventorySettings, type Slip } from './model';
import { readStoredSettings, readStoredSlip, type InventoryStore } from './store-shared';

/**
 * Postgres backend: `inventory_slips(id, kind, date, doc jsonb)` and
 * `inventory_settings(key, version, doc jsonb)`. The schema is created on first use
 * (`CREATE TABLE IF NOT EXISTS`); settings updates are compare-and-set on `version`, so two
 * instances never clobber each other. Any `{ query(text, values) }` works — `pg.Pool` in
 * production, PGlite in the unit tests.
 */
export interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null; affectedRows?: number }>;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS inventory_slips (
     id text PRIMARY KEY,
     kind text NOT NULL,
     date text NOT NULL,
     doc jsonb NOT NULL,
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS inventory_slips_kind_date ON inventory_slips (kind, date)`,
  `CREATE TABLE IF NOT EXISTS inventory_settings (
     key text PRIMARY KEY,
     version integer NOT NULL DEFAULT 0,
     doc jsonb NOT NULL
   )`,
];

const CAS_ATTEMPTS = 5;

export class PgInventoryStore implements InventoryStore {
  private readonly db: Queryable;
  private readonly pool: Pool | null;
  private ready: Promise<void> | null = null;

  constructor(urlOrDb: string | Queryable) {
    if (typeof urlOrDb === 'string') {
      this.pool = new Pool({ connectionString: urlOrDb, max: 4, connectionTimeoutMillis: 10_000 });
      this.pool.on('error', (e) => log.error('inventory pool error', { detail: e.message }));
      this.db = this.pool;
    } else {
      this.pool = null;
      this.db = urlOrDb;
    }
  }

  private ensure(): Promise<void> {
    if (!this.ready) {
      this.ready = (async () => {
        for (const stmt of SCHEMA) await this.db.query(stmt);
      })().catch((e) => {
        this.ready = null;
        throw e;
      });
    }
    return this.ready;
  }

  async listSlips(): Promise<Slip[]> {
    await this.ensure();
    const res = await this.db.query('SELECT id, doc FROM inventory_slips ORDER BY date DESC, id');
    const out: Slip[] = [];
    for (const row of res.rows) {
      const slip = readStoredSlip({ ...(row.doc as object), id: row.id }, 'inventory_slips');
      if (slip) out.push(slip);
    }
    return out;
  }

  async getSlip(id: string): Promise<Slip | null> {
    await this.ensure();
    const res = await this.db.query('SELECT id, doc FROM inventory_slips WHERE id = $1', [id]);
    const row = res.rows[0];
    return row ? readStoredSlip({ ...(row.doc as object), id: row.id }, 'inventory_slips') : null;
  }

  async putSlips(slips: readonly Slip[]): Promise<void> {
    await this.ensure();
    for (const s of slips) {
      await this.db.query(
        `INSERT INTO inventory_slips (id, kind, date, doc, updated_at) VALUES ($1, $2, $3, $4::jsonb, now())
         ON CONFLICT (id) DO UPDATE SET kind = EXCLUDED.kind, date = EXCLUDED.date, doc = EXCLUDED.doc, updated_at = now()`,
        [s.id, s.kind, s.date, JSON.stringify(s)],
      );
    }
  }

  async deleteSlip(id: string): Promise<boolean> {
    await this.ensure();
    const res = await this.db.query('DELETE FROM inventory_slips WHERE id = $1', [id]);
    return (res.rowCount ?? res.affectedRows ?? 0) > 0;
  }

  private async readSettings(): Promise<{ settings: InventorySettings; version: number | null }> {
    const res = await this.db.query(`SELECT version, doc FROM inventory_settings WHERE key = 'settings'`);
    const row = res.rows[0];
    if (!row) return { settings: defaultInventorySettings(), version: null };
    return { settings: readStoredSettings(row.doc, defaultInventorySettings()), version: Number(row.version) };
  }

  async getSettings(): Promise<InventorySettings> {
    await this.ensure();
    return (await this.readSettings()).settings;
  }

  async updateSettings(mutate: (current: InventorySettings) => InventorySettings | null): Promise<InventorySettings> {
    await this.ensure();
    for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
      const { settings, version } = await this.readSettings();
      const next = mutate(structuredClone(settings));
      if (next === null) return settings;
      const doc = JSON.stringify(next);
      if (version === null) {
        const ins = await this.db.query(`INSERT INTO inventory_settings (key, version, doc) VALUES ('settings', 1, $1::jsonb) ON CONFLICT (key) DO NOTHING`, [doc]);
        if ((ins.rowCount ?? ins.affectedRows ?? 0) > 0) return next;
      } else {
        const upd = await this.db.query(`UPDATE inventory_settings SET doc = $1::jsonb, version = version + 1 WHERE key = 'settings' AND version = $2`, [doc, version]);
        if ((upd.rowCount ?? upd.affectedRows ?? 0) > 0) return next;
      }
      log.warn('inventory settings write raced, retrying', { attempt });
    }
    throw conflict();
  }

  async close(): Promise<void> {
    await this.pool?.end();
  }
}
