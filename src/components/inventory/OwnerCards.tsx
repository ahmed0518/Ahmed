'use client';

import { useState } from 'react';
import { KINDS, SLIP_KINDS, SYNC_BOARDS, type SectionAccess, type SlipKind, type SyncBoard, type SyncStamp } from '@/lib/inventory/model';
import { call, niceTime } from './format';

/** Owner only: who hands in a slip every day. */
export function JewelersCard({ jewelers, onSaved, toast }: { jewelers: string[]; onSaved: (names: string[]) => void; toast: (t: string) => void }) {
  const [text, setText] = useState(jewelers.join(', '));
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const names = text.split(',').map((x) => x.trim()).filter(Boolean);
      const res = await call<{ jewelers: string[] }>('/api/inventory/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jewelers: names }) });
      onSaved(res.jewelers);
      setText(res.jewelers.join(', '));
      toast('Saved');
    } catch {
      toast('Could not save the list');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="inv-card" aria-labelledby="inv-jewelers-title">
      <div className="inv-card-head">
        <h2 id="inv-jewelers-title">
          Jewelers<span className="inv-sub">Who should hand in a slip every day, separated by commas</span>
        </h2>
      </div>
      <div className="inv-namebar">
        <input aria-label="Jewelers" value={text} placeholder="Chaerin, Mr. Sim, Mr. Kim" onChange={(e) => setText(e.target.value)} />
        <button type="button" className="inv-btn inv-small inv-primary" disabled={busy} onClick={save}>
          Save
        </button>
      </div>
    </section>
  );
}

const BOARD_LABEL: Record<SyncBoard, string> = { dust: 'Gold dust (Jalgas)', diamond: 'Diamonds (Mr. Jin)', scrap: 'Scrap (Jalgas)', casting: 'Castings (Rina)' };

/** Owner only: the last monday.com pull per board and a Sync now button. */
export function SyncCard({ lastSync, enabled, onSynced, toast }: { lastSync: Partial<Record<string, SyncStamp>>; enabled: boolean; onSynced: () => Promise<void>; toast: (t: string) => void }) {
  const [busy, setBusy] = useState(false);
  async function sync() {
    setBusy(true);
    try {
      const res = await call<{ ok: boolean; results: { board: string; ok: boolean; written: number; error?: string }[] }>('/api/inventory/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      await onSynced();
      const failed = res.results.filter((r) => !r.ok);
      toast(failed.length ? `Synced with errors: ${failed.map((r) => r.board).join(', ')}` : `Synced ${res.results.reduce((t, r) => t + r.written, 0)} records`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Sync failed');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="inv-card" aria-labelledby="inv-sync-title">
      <div className="inv-card-head">
        <h2 id="inv-sync-title">
          monday.com<span className="inv-sub">{enabled ? 'Pulled every hour; the stamps say when each board was last read' : 'Not connected on this server (MONDAY_API_TOKEN)'}</span>
        </h2>
        {enabled ? (
          <button type="button" className="inv-btn inv-small" disabled={busy} onClick={sync}>
            {busy ? 'Syncing…' : 'Sync now'}
          </button>
        ) : null}
      </div>
      <ul className="inv-sync">
        {SYNC_BOARDS.map((b) => {
          const s = lastSync[b];
          return (
            <li key={b}>
              <span>{BOARD_LABEL[b]}</span>
              <span className="inv-ok">{!s ? 'never synced' : s.ok ? `${niceTime(s.at)} · ${s.count} records` : `failed ${niceTime(s.at)}${s.error ? ` · ${s.error}` : ''}`}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Owner only: who sees which section, and who may save. Staff not listed see everything and may write. */
export function PeopleCard({ staff, access, onSaved, toast }: { staff: { id: string; name: string }[]; access: Record<string, SectionAccess>; onSaved: (a: Record<string, SectionAccess>) => void; toast: (t: string) => void }) {
  async function update(id: string, patch: (cur: SectionAccess) => SectionAccess) {
    const cur = access[id] ?? { sections: [...SLIP_KINDS], write: true };
    const next = { ...access, [id]: patch(cur) };
    try {
      const res = await call<{ access: Record<string, SectionAccess> }>('/api/inventory/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ access: next }) });
      onSaved(res.access);
      toast('Access updated');
    } catch {
      toast('Could not update access');
    }
  }
  return (
    <section className="inv-card" aria-labelledby="inv-people-title">
      <div className="inv-card-head">
        <h2 id="inv-people-title">
          People<span className="inv-sub">Who sees which section and who may save. Everyone on the staff list starts with everything; tap a chip to change it. Owners always see everything.</span>
        </h2>
      </div>
      {staff.length === 0 ? <p className="inv-empty">No staff names yet — add them in /admin.</p> : null}
      {staff.map((p) => {
        const rule = access[p.id] ?? { sections: [...SLIP_KINDS], write: true };
        return (
          <div className="inv-person" key={p.id} data-testid={`person-${p.id}`}>
            <div className="inv-pname">
              {p.name}
              <span className="inv-sub">{rule.sections.length === 0 ? 'no section' : rule.sections.length === SLIP_KINDS.length ? 'everything' : rule.sections.map((k) => KINDS[k].short).join(', ')} · {rule.write ? 'can save' : 'view only'}</span>
            </div>
            <div className="inv-chips">
              {SLIP_KINDS.map((k: SlipKind) => (
                <button
                  key={k}
                  type="button"
                  className="inv-chip"
                  aria-pressed={rule.sections.includes(k)}
                  aria-label={`${p.name}: ${KINDS[k].short}`}
                  onClick={() => update(p.id, (cur) => ({ ...cur, sections: cur.sections.includes(k) ? cur.sections.filter((x) => x !== k) : [...cur.sections, k] }))}
                >
                  {KINDS[k].short}
                </button>
              ))}
              <button type="button" className="inv-chip" aria-pressed={rule.write} aria-label={`${p.name}: can save`} onClick={() => update(p.id, (cur) => ({ ...cur, write: !cur.write }))}>
                Can save
              </button>
            </div>
          </div>
        );
      })}
    </section>
  );
}
