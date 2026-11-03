'use client';

import { KINDS, type SlipKind } from '@/lib/inventory/model';

/** The slip being reviewed before Save: every cell a string, exactly what the person sees. */
export interface Draft {
  kind: SlipKind;
  who: string;
  date: string;
  lines: Record<string, string>[];
  note: string;
  dust: string;
  dir: 'in' | 'out';
  to: string;
  reading: boolean;
  error: string;
  preview: string | null;
  source: 'scan' | 'manual';
  saving: boolean;
}

export function emptyDraft(kind: SlipKind, today: string, d: Partial<Draft> = {}): Draft {
  const draft: Draft = { kind, who: '', date: today, lines: [], note: '', dust: '', dir: 'in', to: '', reading: false, error: '', preview: null, source: 'manual', saving: false, ...d };
  if (!draft.lines.length && !draft.reading) draft.lines.push({});
  return draft;
}

interface Props {
  draft: Draft;
  names: string[];
  batch: { done: number; total: number };
  queued: number;
  onChange: (next: Draft) => void;
  onSave: () => void;
  onDiscard: () => void;
  onStop: () => void;
  onSkipRest: () => void;
}

export function ReviewForm({ draft, names, batch, queued, onChange, onSave, onDiscard, onStop, onSkipRest }: Props) {
  const K = KINDS[draft.kind];
  const gridCols = K.cols.map((c) => c.w ?? (c.type === 'num' ? (K.cols.length > 3 ? '68px' : '82px') : '1fr')).join(' ') + ' 28px';
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });
  const setLine = (i: number, key: string, value: string) => set({ lines: draft.lines.map((l, j) => (j === i ? { ...l, [key]: value } : l)) });
  const removeLine = (i: number) => {
    const lines = draft.lines.filter((_, j) => j !== i);
    set({ lines: lines.length ? lines : [{}] });
  };
  return (
    <section className="inv-card inv-review" aria-labelledby="inv-review-title" data-testid="review">
      <div className="inv-card-head">
        <h2 id="inv-review-title">
          {draft.source === 'scan' ? 'Check what was read' : `New slip: ${K.title}`}
          {batch.total > 1 ? (
            <span className="inv-sub">
              slip {batch.done} of {batch.total}
            </span>
          ) : null}
        </h2>
        {queued > 0 ? (
          <button type="button" className="inv-btn inv-small" onClick={onSkipRest}>
            Skip the rest
          </button>
        ) : null}
      </div>
      {draft.preview ? (
        <div className="inv-preview">
          {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL of the photo just taken */}
          <img src={draft.preview} alt="The slip" />
          <p className="inv-ok">Fix anything that was read wrong before you save. Nothing is saved until you tap Save.</p>
        </div>
      ) : null}
      {draft.reading ? (
        <div className="inv-reading">
          <span className="inv-dot" />
          <span>Reading {batch.total > 1 ? `slip ${batch.done} of ${batch.total}` : 'the slip'}… this can take up to a minute.</span>
          <button type="button" className="inv-btn inv-small" style={{ marginLeft: 'auto' }} onClick={onStop}>
            Stop
          </button>
        </div>
      ) : (
        <>
          <div className="inv-two">
            <div className="inv-field">
              <label htmlFor="f-who">{K.who}</label>
              <input id="f-who" list="inv-names" value={draft.who} placeholder="Name" autoComplete="off" onChange={(e) => set({ who: e.target.value })} />
              <datalist id="inv-names">
                {names.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
            </div>
            <div className="inv-field">
              <label htmlFor="f-date">Date</label>
              <input id="f-date" type="date" value={draft.date} onChange={(e) => set({ date: e.target.value })} />
            </div>
          </div>
          <div className="inv-lines">
            <div className="inv-hdr" style={{ gridTemplateColumns: gridCols }}>
              {K.cols.map((c) => (
                <span key={c.key} style={c.type === 'num' ? { textAlign: 'right' } : undefined}>
                  {c.label}
                </span>
              ))}
              <span />
            </div>
            {draft.lines.map((l, i) => (
              <div className="inv-line" key={i} style={{ gridTemplateColumns: gridCols }}>
                {K.cols.map((c) => (
                  <input
                    key={c.key}
                    className={c.type === 'num' ? 'inv-n' : undefined}
                    inputMode={c.type === 'num' ? 'decimal' : undefined}
                    value={l[c.key] ?? ''}
                    placeholder={c.type === 'num' ? '0' : c.ph}
                    aria-label={`${c.label} ${i + 1}`}
                    onChange={(e) => setLine(i, c.key, e.target.value)}
                  />
                ))}
                <button type="button" className="inv-x" aria-label={`Remove line ${i + 1}`} onClick={() => removeLine(i)}>
                  ×
                </button>
              </div>
            ))}
            <button type="button" className="inv-btn inv-small" onClick={() => set({ lines: [...draft.lines, {}] })}>
              + Add {K.item}
            </button>
          </div>
          {draft.kind === 'metal' ? (
            <div className="inv-field">
              <label htmlFor="f-dust">Dust / filings given back (g)</label>
              <input id="f-dust" inputMode="decimal" value={draft.dust} placeholder="0" style={{ maxWidth: 140 }} onChange={(e) => set({ dust: e.target.value })} />
            </div>
          ) : null}
          {draft.kind === 'scrap' ? (
            <div className="inv-two">
              <div className="inv-field">
                <label htmlFor="f-dir">Direction</label>
                <select id="f-dir" value={draft.dir} onChange={(e) => set({ dir: e.target.value === 'out' ? 'out' : 'in' })}>
                  <option value="in">Scrapped (in)</option>
                  <option value="out">Given out</option>
                </select>
              </div>
              {draft.dir === 'out' ? (
                <div className="inv-field">
                  <label htmlFor="f-to">To</label>
                  <input id="f-to" value={draft.to} placeholder="Mr. Kim, refinery…" onChange={(e) => set({ to: e.target.value })} />
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="inv-field">
            <label htmlFor="f-note">Note</label>
            <textarea id="f-note" rows={2} placeholder="Anything worth remembering" value={draft.note} onChange={(e) => set({ note: e.target.value })} />
          </div>
          {draft.error ? (
            <p className="inv-msg" role="alert">
              {draft.error}
            </p>
          ) : null}
          <div className="inv-buttons">
            <button type="button" className="inv-btn" onClick={onDiscard}>
              Discard
            </button>
            <button type="button" className="inv-btn inv-primary" disabled={draft.saving} onClick={onSave}>
              {draft.saving ? 'Saving…' : 'Save slip'}
            </button>
          </div>
        </>
      )}
      {draft.reading && draft.error ? (
        <p className="inv-msg" role="alert">
          {draft.error}
        </p>
      ) : null}
    </section>
  );
}
