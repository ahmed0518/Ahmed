'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Period } from '@/lib/inventory/compute';
import { tiles as computeTiles } from '@/lib/inventory/compute';
import { KINDS, SLIP_KINDS, numberCell, type SectionAccess, type Slip, type SlipKind } from '@/lib/inventory/model';
import type { InventoryPayload } from '@/lib/inventory/service';
import type { ScanDraft } from '@/lib/inventory/scan';
import { call, fmt, money, niceDate } from './format';
import { JewelersCard, PeopleCard, SyncCard } from './OwnerCards';
import { ReviewForm, emptyDraft, type Draft } from './ReviewForm';
import { SlipLog } from './SlipLog';
import { Summary } from './Summary';
import './inventory.css';

interface Props {
  initial: InventoryPayload;
  access: Record<string, SectionAccess>;
  staff: { id: string; name: string }[];
  syncEnabled: boolean;
}

const SECTION_KEY = 'trax-section';

function sectionFromLink(): SlipKind | null {
  if (typeof window === 'undefined') return null;
  const m = (window.location.hash + window.location.search).toLowerCase().match(/metal|diamond|scrap|casting/);
  return m ? (m[0] as SlipKind) : null;
}

interface QueueItem {
  file: File;
  kind: SlipKind;
}
interface Prefetch {
  item: QueueItem;
  ctl: AbortController;
  promise: Promise<ScanDraft | { __error: Error }>;
}

/** The inventory page (SPEC §14): the four tiles, the summary, the log, the review form, the owner cards. */
export function InventoryApp({ initial, access: initialAccess, staff, syncEnabled }: Props) {
  const allowed = initial.viewer.sections;
  const [kind, setKind] = useState<SlipKind>(allowed[0] ?? 'metal');
  const [period, setPeriod] = useState<Period>('month');
  const [slips, setSlips] = useState<Slip[]>(initial.slips);
  const [settings, setSettings] = useState(initial.settings);
  const [access, setAccess] = useState(initialAccess);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [batch, setBatch] = useState({ done: 0, total: 0 });
  const [queued, setQueued] = useState(0);
  const [toastText, setToastText] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const draftRef = useRef<Draft | null>(null);
  draftRef.current = draft;
  const queue = useRef<QueueItem[]>([]);
  const prefetch = useRef<Prefetch | null>(null);
  const ctl = useRef<AbortController | null>(null);
  const batchRef = useRef({ done: 0, total: 0 });
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const reviewRef = useRef<HTMLDivElement>(null);

  const canWrite = initial.viewer.can_write;
  const scanOn = initial.scan_enabled && canWrite;
  const today = initial.today;

  // Remember the section per device; a #diamond link wins over the memory.
  useEffect(() => {
    let k: SlipKind | null = sectionFromLink();
    if (!k) {
      try {
        const saved = localStorage.getItem(SECTION_KEY);
        if (saved && (SLIP_KINDS as readonly string[]).includes(saved)) k = saved as SlipKind;
      } catch {
        /* no storage */
      }
    }
    if (k && allowed.includes(k)) setKind(k);
    const onHash = () => {
      const h = sectionFromLink();
      if (h && allowed.includes(h)) {
        setKind(h);
        setExpanded(null);
        setConfirming(null);
        setOpenGroup(null);
      }
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [allowed]);

  const toast = useCallback((text: string) => {
    setToastText(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastText(null), 1800);
  }, []);

  function pickKind(k: SlipKind) {
    setKind(k);
    setExpanded(null);
    setConfirming(null);
    setOpenGroup(null);
    try {
      localStorage.setItem(SECTION_KEY, k);
    } catch {
      /* no storage */
    }
  }

  const reload = useCallback(async () => {
    const data = await call<InventoryPayload>('/api/inventory');
    setSlips(data.slips);
    setSettings(data.settings);
  }, []);

  const tiles = useMemo(() => computeTiles(slips, today, settings.scrap_since), [slips, today, settings.scrap_since]);
  const names = useMemo(() => [...new Set(slips.filter((s) => s.kind === (draft?.kind ?? kind)).map((s) => s.who).filter(Boolean))], [slips, draft?.kind, kind]);

  // ---------- review form ----------
  function openDraft(d: Partial<Draft>) {
    const next = emptyDraft(d.kind ?? kind, today, d);
    if (!next.who && !initial.viewer.owner && initial.viewer.name && next.source === 'manual') next.who = initial.viewer.name;
    setDraft(next);
    setTimeout(() => reviewRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 0);
  }
  function closeDraft() {
    if (ctl.current) {
      ctl.current.abort();
      ctl.current = null;
    }
    if (draftRef.current?.preview) URL.revokeObjectURL(draftRef.current.preview);
    setDraft(null);
  }

  async function saveDraft() {
    const d = draftRef.current;
    if (!d || d.saving) return;
    const K = KINDS[d.kind];
    const lines = d.lines
      .map((l) => {
        const o: Record<string, string | number | null> = {};
        for (const c of K.cols) o[c.key] = c.type === 'num' ? (numberCell(l[c.key]) ?? null) : String(l[c.key] ?? '').trim();
        return o;
      })
      .filter((o) => K.cols.some((c) => (c.type === 'num' ? o[c.key] !== null : o[c.key] !== '')));
    const dust = d.kind === 'metal' ? numberCell(d.dust) : null;
    if (!lines.length && !(d.kind === 'metal' && dust !== null && dust !== undefined)) return setDraft({ ...d, error: 'Add at least one line with a number.' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) return setDraft({ ...d, error: 'Pick a date.' });
    if (dust === undefined) return setDraft({ ...d, error: 'The dust weight must be a number.' });
    const body: Record<string, unknown> = { kind: d.kind, who: d.who.trim(), date: d.date, lines, note: d.note.trim(), source: d.source };
    if (d.kind === 'metal') body.dust = dust;
    if (d.kind === 'scrap') {
      body.dir = d.dir;
      if (d.dir === 'out') body.to = d.to.trim();
    }
    setDraft({ ...d, saving: true, error: '' });
    try {
      const res = await call<{ slip: Slip }>('/api/inventory/slips', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      setSlips((list) => [res.slip, ...list]);
      toast('Saved');
      closeDraft();
      startNext();
    } catch (e) {
      const err = e as Error & { status?: number };
      setDraft({ ...d, saving: false, error: err.status === 401 ? 'Your sign-in expired. Reload the page and log in again.' : err.status === 403 ? 'This view can only read, not save.' : err.message || 'Could not save. Try again in a moment.' });
    }
  }

  // ---------- scanning ----------
  const readSlip = useCallback(async (file: File, k: SlipKind, signal: AbortSignal): Promise<ScanDraft> => {
    const form = new FormData();
    form.append('kind', k);
    form.append('image', file);
    const res = await fetch('/api/inventory/scan', { method: 'POST', body: form, signal });
    const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string; draft?: ScanDraft };
    if (!res.ok || !data.draft) {
      const err = new Error(data.error ?? `Request failed (${res.status})`) as Error & { code?: string };
      err.code = data.code;
      throw err;
    }
    return data.draft;
  }, []);

  function enqueue(files: File[]) {
    queue.current.push(...files.map((f) => ({ file: f, kind })));
    batchRef.current = { ...batchRef.current, total: batchRef.current.total + files.length };
    setBatch({ ...batchRef.current });
    setQueued(queue.current.length);
    if (!draftRef.current) startNext();
  }
  function startNext() {
    if (!queue.current.length) {
      batchRef.current = { done: 0, total: 0 };
      setBatch({ done: 0, total: 0 });
      setQueued(0);
      return;
    }
    const item = queue.current.shift()!;
    batchRef.current = { ...batchRef.current, done: batchRef.current.done + 1 };
    setBatch({ ...batchRef.current });
    setQueued(queue.current.length);
    const pre = prefetch.current && prefetch.current.item === item ? prefetch.current : null;
    prefetch.current = null;
    void scanFile(item.file, item.kind, pre);
    const nxt = queue.current[0];
    if (nxt) {
      const c = new AbortController();
      prefetch.current = { item: nxt, ctl: c, promise: readSlip(nxt.file, nxt.kind, c.signal).catch((e: Error) => ({ __error: e })) };
    }
  }
  function dropQueue() {
    if (prefetch.current) {
      prefetch.current.ctl.abort();
      prefetch.current = null;
    }
    queue.current = [];
    batchRef.current = { done: 0, total: 0 };
    setBatch({ done: 0, total: 0 });
    setQueued(0);
  }

  async function scanFile(file: File, k: SlipKind, pre: Prefetch | null) {
    if (k !== kind) pickKind(k);
    const myCtl = pre ? pre.ctl : new AbortController();
    ctl.current = myCtl;
    openDraft({ kind: k, reading: true, preview: URL.createObjectURL(file), source: 'scan', lines: [] });
    try {
      const data = pre ? await pre.promise : await readSlip(file, k, myCtl.signal);
      if ('__error' in data) throw data.__error;
      const cur = draftRef.current;
      if (!cur || myCtl.signal.aborted) return;
      const K = KINDS[k];
      const lines = data.lines.map((l) => {
        const o: Record<string, string> = {};
        for (const c of K.cols) o[c.key] = l[c.key] ?? '';
        return o;
      });
      setDraft({
        ...cur,
        lines: lines.length ? lines : [{}],
        who: data.who,
        date: data.date ?? today,
        note: data.note,
        dust: k === 'metal' ? data.dust : '',
        dir: k === 'scrap' ? data.dir : 'in',
        to: k === 'scrap' ? data.to : '',
        reading: false,
      });
    } catch (e) {
      const cur = draftRef.current;
      if (!cur) return;
      const err = e as Error & { code?: string; name?: string };
      if (err.name === 'AbortError') return setDraft({ ...cur, reading: false, lines: [{}], error: 'Stopped. Fill it in by hand or discard.' });
      setDraft({ ...cur, reading: false, lines: [{}], error: err.message || 'Could not reach Claude. Fill the slip in by hand, or try the scan again.' });
    } finally {
      if (ctl.current === myCtl) ctl.current = null;
    }
  }

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])];
    e.target.value = '';
    if (files.length) enqueue(files);
  };

  async function remove(id: string) {
    setConfirming(null);
    try {
      await call(`/api/inventory/slips/${encodeURIComponent(id)}`, { method: 'DELETE' });
      setSlips((list) => list.filter((s) => s.id !== id));
      if (expanded === id) setExpanded(null);
      toast('Deleted');
    } catch {
      toast('Could not delete');
    }
  }

  const noSection = allowed.length === 0;

  return (
    <div className="inv">
      <header className="inv-top">
        <h1>TRAX Inventory</h1>
        <p className="inv-status">{canWrite ? `Saving as ${initial.viewer.name}` : 'View only'}</p>
      </header>

      {noSection ? (
        <section className="inv-card">
          <p className="inv-empty">You don&apos;t have a section on this page yet. Ask Ahmed to give you one, then reload.</p>
        </section>
      ) : (
        <>
          <nav className="inv-tiles" role="tablist" aria-label="Category">
            {SLIP_KINDS.filter((k) => allowed.includes(k)).map((k) => {
              let num = '—';
              let hint = '';
              if (k === 'metal') {
                num = tiles.metal.any ? `${fmt(tiles.metal.dust, 1)} g` : '—';
                hint = tiles.metal.any ? `dust this month · ${tiles.metal.people} ${tiles.metal.people === 1 ? 'person' : 'people'}` : 'nothing this month';
              } else if (k === 'diamond') {
                num = tiles.diamond ? `${fmt(tiles.diamond.ct, 2)} ct` : '—';
                hint = tiles.diamond ? `${money(tiles.diamond.value)} · as of ${niceDate(tiles.diamond.date, today)}` : 'no count yet';
              } else if (k === 'casting') {
                num = tiles.casting ? `${fmt(tiles.casting.pcs, 0)} pcs` : '—';
                hint = tiles.casting ? `${money(tiles.casting.value)} · as of ${niceDate(tiles.casting.date, today)}` : 'no count yet';
              } else {
                num = tiles.scrap.any ? `${fmt(tiles.scrap.onhand, 1)} g` : '—';
                hint = tiles.scrap.any ? `on hand · ${money(tiles.scrap.value)}` : 'nothing logged yet';
              }
              return (
                <button key={k} type="button" className="inv-tile" role="tab" data-kind={k} aria-selected={kind === k} onClick={() => pickKind(k)} data-testid={`tile-${k}`}>
                  <span className="inv-label">{KINDS[k].title}</span>
                  <span className="inv-num">{num}</span>
                  <span className="inv-hint">{hint}</span>
                </button>
              );
            })}
          </nav>

          {notice ? (
            <div className="notice notice--error" role="alert">
              {notice}
            </div>
          ) : null}

          {canWrite && !draft ? (
            <section className="inv-actions">
              {scanOn ? (
                <button type="button" className="inv-btn" onClick={() => fileInput.current?.click()}>
                  Upload photos
                </button>
              ) : null}
              <button type="button" className="inv-btn" onClick={() => openDraft({ kind, source: 'manual' })}>
                Add by hand
              </button>
              <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple hidden onChange={onPick} aria-label="Upload photos of slips" />
              <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={onPick} aria-label="Take a photo of a slip" />
            </section>
          ) : null}

          {draft ? (
            <div ref={reviewRef}>
              <ReviewForm
                draft={draft}
                names={names}
                batch={batch}
                queued={queued}
                onChange={setDraft}
                onSave={saveDraft}
                onDiscard={() => {
                  closeDraft();
                  startNext();
                }}
                onStop={() => ctl.current?.abort()}
                onSkipRest={dropQueue}
              />
            </div>
          ) : null}

          <Summary kind={kind} slips={slips} period={period} today={today} jewelers={settings.jewelers} scrapSinceDate={settings.scrap_since} openGroup={openGroup} onPeriod={setPeriod} onToggleGroup={(g) => setOpenGroup(openGroup === g ? null : g)} />

          {initial.viewer.owner && kind === 'metal' ? <JewelersCard jewelers={settings.jewelers} onSaved={(jewelers) => setSettings((s) => ({ ...s, jewelers }))} toast={toast} /> : null}

          <section className="inv-card" aria-labelledby="inv-log-title">
            <div className="inv-card-head">
              <h2 id="inv-log-title">{kind === 'diamond' || kind === 'casting' ? 'Counts' : 'Slips'}</h2>
            </div>
            <SlipLog kind={kind} slips={slips} today={today} canWrite={canWrite} expanded={expanded} confirming={confirming} onToggle={(id) => { setExpanded(expanded === id ? null : id); setConfirming(null); }} onConfirm={setConfirming} onDelete={remove} />
          </section>

          {initial.viewer.owner ? (
            <>
              <SyncCard lastSync={settings.last_sync} enabled={syncEnabled} onSynced={async () => { try { await reload(); } catch { setNotice('Could not reload after the sync — refresh the page.'); } }} toast={toast} />
              <PeopleCard staff={staff} access={access} onSaved={setAccess} toast={toast} />
            </>
          ) : null}

          {canWrite && !draft ? (
            <>
              <span className="inv-fab-hint">{scanOn ? 'Take a photo' : 'Add a slip'}</span>
              <button type="button" className="inv-fab" aria-label={scanOn ? 'Take a photo of a slip' : 'Add a slip'} onClick={() => (scanOn ? cameraInput.current?.click() : openDraft({ kind, source: 'manual' }))}>
                +
              </button>
            </>
          ) : null}
        </>
      )}
      <div className={`inv-toast${toastText ? ' inv-show' : ''}`} role="status" aria-live="polite">
        {toastText ?? ''}
      </div>
    </div>
  );
}
