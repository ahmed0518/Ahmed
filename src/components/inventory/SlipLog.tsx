'use client';

import { num, slipAmount, sortSlips } from '@/lib/inventory/compute';
import { KINDS, type Slip, type SlipKind } from '@/lib/inventory/model';
import { fmt, niceDate, plural } from './format';

interface Props {
  kind: SlipKind;
  slips: Slip[];
  today: string;
  canWrite: boolean;
  expanded: string | null;
  confirming: string | null;
  onToggle: (id: string) => void;
  onConfirm: (id: string | null) => void;
  onDelete: (id: string) => void;
}

function cell(col: { key: string; type: 'text' | 'num'; dp?: number }, v: unknown): string {
  if (col.key === 'price') return v === null || v === undefined ? '—' : `$${fmt(Number(v), 0)}`;
  if (col.type === 'num') return fmt(v as number | null, col.dp ?? 2);
  return String(v ?? '');
}

/** The log of saved slips for the open section, newest first; tap a row for its lines. */
export function SlipLog({ kind, slips, today, canWrite, expanded, confirming, onToggle, onConfirm, onDelete }: Props) {
  const K = KINDS[kind];
  const list = sortSlips(slips.filter((s) => s.kind === kind));
  if (!list.length) return <p className="inv-empty" style={{ padding: '6px 14px 8px' }}>Nothing saved yet.</p>;
  return (
    <div className="inv-log">
      {list.map((s) => {
        const lines = (s.kind === 'diamond' ? [...s.lines].sort((a, b) => (num(a.size) ?? 999) - (num(b.size) ?? 999)) : s.lines) as unknown as Record<string, unknown>[];
        const open = expanded === s.id;
        const meta = `${s.kind === 'metal' && !lines.length ? 'dust only' : plural(lines.length, K.item)}${s.source === 'scan' ? ' · scanned' : s.source === 'monday' ? ' · from monday.com' : s.source === 'import' ? ' · imported' : ''}${s.note ? ' · note' : ''}`;
        return (
          <div className="inv-slip" key={s.id} data-testid={`slip-${s.id}`}>
            <button type="button" aria-expanded={open} onClick={() => onToggle(s.id)}>
              <span className="inv-date">{niceDate(s.date, today)}</span>
              <span className="inv-who">{s.who || 'Unnamed'}</span>
              <span className="inv-amt">{slipAmount(s)}</span>
              <span className="inv-meta">{meta}</span>
            </button>
            {open ? (
              <div className="inv-detail">
                <div className="inv-scroll">
                  <table>
                    <thead>
                      <tr>
                        {K.cols.map((c) => (
                          <th key={c.key}>{c.label}</th>
                        ))}
                        {s.kind === 'metal' ? <th>Loss g</th> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((l, i) => (
                        <tr key={i}>
                          {K.cols.map((c) => (
                            <td key={c.key}>{cell(c, l[c.key])}</td>
                          ))}
                          {s.kind === 'metal' ? <td>{num(l.before as number | null) !== null && num(l.after as number | null) !== null ? fmt((l.before as number) - (l.after as number), 2) : '—'}</td> : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {s.kind === 'metal' && num(s.dust) !== null ? <p className="inv-note">Dust returned: {fmt(s.dust, 2)} g</p> : null}
                {s.note ? <p className="inv-note">{s.note}</p> : null}
                {s.createdBy ? <p className="inv-note">Saved by {s.createdBy}</p> : null}
                {s.source === 'monday' ? (
                  <p className="inv-note">Mirrors the monday.com board — change or delete it there; the next sync follows.</p>
                ) : null}
                {canWrite && s.source !== 'monday' ? (
                  <div className="inv-row">
                    {confirming === s.id ? (
                      <>
                        <button type="button" className="inv-btn inv-small" onClick={() => onConfirm(null)}>
                          Keep
                        </button>
                        <button type="button" className="inv-btn inv-small inv-danger" onClick={() => onDelete(s.id)}>
                          Yes, delete
                        </button>
                      </>
                    ) : (
                      <button type="button" className="inv-btn inv-small inv-danger" onClick={() => onConfirm(s.id)}>
                        Delete
                      </button>
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
