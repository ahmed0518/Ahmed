'use client';

import { byKind, inPeriod, latestCasting, latestCount, metalRows, missingToday, scrapSince, scrapSummary, type Period } from '@/lib/inventory/compute';
import { KINDS, type Slip, type SlipKind } from '@/lib/inventory/model';
import { fmt, money, niceDate, plural } from './format';

interface Props {
  kind: SlipKind;
  slips: Slip[];
  period: Period;
  today: string;
  jewelers: string[];
  scrapSinceDate: string;
  openGroup: string | null;
  onPeriod: (p: Period) => void;
  onToggleGroup: (name: string) => void;
}

const periodWord = (p: Period) => (p === 'today' ? 'today' : p === 'month' ? 'this month' : 'yet');

/** The summary card: the per-section table exactly as the artifact renders it. */
export function Summary({ kind, slips, period, today, jewelers, scrapSinceDate, openGroup, onPeriod, onToggleGroup }: Props) {
  const K = KINDS[kind];
  const showPeriod = kind === 'metal' || kind === 'scrap';
  let sub = '';
  let body: React.ReactNode;

  if (kind === 'metal') {
    const list = byKind(slips, 'metal');
    const rows = metalRows(list.filter((s) => inPeriod(s, period, today)));
    sub = rows.length ? 'dust handed in per person · loss = before − after on their slips' : '';
    if (!rows.length) body = <p className="inv-empty">Nothing {periodWord(period)}.</p>;
    else {
      const D = rows.reduce((t, r) => t + r.dust, 0);
      const B = rows.reduce((t, r) => t + r.before, 0);
      const A = rows.reduce((t, r) => t + r.after, 0);
      const P = rows.reduce((t, r) => t + r.paired, 0);
      const N = rows.reduce((t, r) => t + r.pairedLoss - r.pairedDust, 0);
      body = (
        <>
          <div className="inv-scroll">
            <table className="inv-wide">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Dust g</th>
                  <th>Before g</th>
                  <th>After g</th>
                  <th>Loss g</th>
                  <th>Net g</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const loss = r.before - r.after;
                  const pct = r.before ? (loss / r.before) * 100 : null;
                  const net = r.paired ? r.pairedLoss - r.pairedDust : null;
                  return (
                    <tr key={r.who} data-testid={`metal-row-${r.who}`}>
                      <td>
                        {r.who}
                        <span className="inv-sub">
                          {plural(r.days, 'day')} of dust
                          {r.slips ? ` · ${plural(r.slips, 'slip')}${r.pcs ? `, ${fmt(r.pcs, 0)} pcs` : ''}` : ''}
                        </span>
                      </td>
                      <td>{fmt(r.dust, 2)}</td>
                      <td>{r.slips ? fmt(r.before, 2) : '—'}</td>
                      <td>{r.slips ? fmt(r.after, 2) : '—'}</td>
                      <td>
                        {r.slips ? fmt(loss, 2) : '—'}
                        {r.slips && pct !== null ? <span className="inv-sub">{fmt(pct, 1)}%</span> : null}
                      </td>
                      <td className={net !== null && net > 0.005 ? 'inv-loss' : ''}>{net === null ? '—' : fmt(net, 2)}</td>
                    </tr>
                  );
                })}
                <tr className="inv-total">
                  <td>Total</td>
                  <td>{fmt(D, 2)}</td>
                  <td>{B ? fmt(B, 2) : '—'}</td>
                  <td>{B ? fmt(A, 2) : '—'}</td>
                  <td>
                    {B ? fmt(B - A, 2) : '—'}
                    {B ? <span className="inv-sub">{fmt(((B - A) / B) * 100, 1)}%</span> : null}
                  </td>
                  <td className={P && N > 0.005 ? 'inv-loss' : ''}>{P ? fmt(N, 2) : '—'}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="inv-ok">Net = loss − dust, only on days that have both a slip and dust. Above zero means metal that didn&apos;t come back. &quot;—&quot; means no before/after slip yet.</p>
        </>
      );
    }
  } else if (kind === 'diamond') {
    const c = latestCount(byKind(slips, 'diamond'));
    sub = c ? `latest count · ${niceDate(c.date, today)}` : '';
    if (!c) body = <p className="inv-empty">No diamond count yet. Scan Mr. Jin&apos;s sheet.</p>;
    else
      body = (
        <>
          <div className="inv-scroll">
            <table>
              <thead>
                <tr>
                  <th>Quality</th>
                  <th>Sizes</th>
                  <th>Ct</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {c.groups.map((g) => {
                  const open = openGroup === g.quality;
                  const gsub = g.date !== c.date ? `as of ${niceDate(g.date, today)}` : g.who;
                  return [
                    <tr key={g.quality} className="inv-q" aria-expanded={open} onClick={() => onToggleGroup(g.quality)} data-testid={`diamond-group-${g.quality}`}>
                      <td>
                        {g.quality} <span className="inv-chev">{open ? '▾' : '▸'}</span>
                        {gsub ? <span className="inv-sub">{gsub}</span> : null}
                      </td>
                      <td>{g.rows.length}</td>
                      <td>{fmt(g.ct, 2)}</td>
                      <td>
                        {money(g.value)}
                        {g.unpriced ? <span className="inv-sub">{g.unpriced} without a price</span> : null}
                      </td>
                    </tr>,
                    open ? (
                      <tr key={`${g.quality}-sizes`} className="inv-sizes">
                        <td colSpan={4}>
                          <table className="inv-inner">
                            <thead>
                              <tr>
                                <th>Size mm</th>
                                <th>Ct</th>
                                <th>$/ct</th>
                                <th>Value</th>
                              </tr>
                            </thead>
                            <tbody>
                              {g.rows.map((r, i) => (
                                <tr key={i}>
                                  <td>{fmt(r.size, 2)}</td>
                                  <td>{fmt(r.carats, 2)}</td>
                                  <td>{money(r.price)}</td>
                                  <td>{money(r.value)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    ) : null,
                  ];
                })}
                <tr className="inv-total">
                  <td>Total</td>
                  <td>{c.n}</td>
                  <td>{fmt(c.ct, 2)}</td>
                  <td>{money(c.value)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="inv-ok">
            Value = ct × $/ct from the sheet.{c.unpriced ? ` ${plural(c.unpriced, 'size')} with no price left out.` : ''}
          </p>
        </>
      );
  } else if (kind === 'casting') {
    const c = latestCasting(byKind(slips, 'casting'));
    sub = c ? `latest count · ${niceDate(c.date, today)}${c.who ? ` · ${c.who}` : ''} · Y ${fmt(c.yellow, 0)} · W ${fmt(c.white, 0)} · R ${fmt(c.rose, 0)}` : '';
    if (!c) body = <p className="inv-empty">No casting count yet.</p>;
    else
      body = (
        <>
          <div className="inv-scroll">
            <table>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Pcs</th>
                  <th>Grams</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {c.groups.map((g) => {
                  const open = openGroup === g.type;
                  return [
                    <tr key={g.type} className="inv-q" aria-expanded={open} onClick={() => onToggleGroup(g.type)} data-testid={`casting-group-${g.type}`}>
                      <td>
                        {g.type} <span className="inv-chev">{open ? '▾' : '▸'}</span>
                        <span className="inv-sub">
                          {plural(g.rows.length, 'item')} · Y {fmt(g.yellow, 0)} · W {fmt(g.white, 0)} · R {fmt(g.rose, 0)}
                        </span>
                      </td>
                      <td>{fmt(g.pcs, 0)}</td>
                      <td>{fmt(g.grams, 1)}</td>
                      <td>{money(g.value)}</td>
                    </tr>,
                    open ? (
                      <tr key={`${g.type}-items`} className="inv-sizes">
                        <td colSpan={4}>
                          <table className="inv-inner">
                            <thead>
                              <tr>
                                <th>Item</th>
                                <th>Y</th>
                                <th>W</th>
                                <th>R</th>
                                <th>Pcs</th>
                                <th>Value</th>
                              </tr>
                            </thead>
                            <tbody>
                              {g.rows.map((r, i) => (
                                <tr key={i}>
                                  <td>
                                    {r.item}
                                    <span className="inv-sub">
                                      {r.karat}
                                      {r.weight !== null ? ` · ${fmt(r.weight, 2)} g each` : ''}
                                    </span>
                                  </td>
                                  <td>{r.yellow === null ? '—' : fmt(r.yellow, 0)}</td>
                                  <td>{r.white === null ? '—' : fmt(r.white, 0)}</td>
                                  <td>{r.rose === null ? '—' : fmt(r.rose, 0)}</td>
                                  <td>{fmt(r.pcs, 0)}</td>
                                  <td>{money(r.value)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    ) : null,
                  ];
                })}
                <tr className="inv-total">
                  <td>
                    Total<span className="inv-sub">{c.items} items</span>
                  </td>
                  <td>{fmt(c.pcs, 0)}</td>
                  <td>{fmt(c.grams, 1)}</td>
                  <td>{money(c.value)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="inv-ok">Value = pieces × grams each × $/g. Tap a type to see each item.</p>
        </>
      );
  } else {
    const ledger = scrapSince(byKind(slips, 'scrap'), scrapSinceDate);
    const all = scrapSummary(ledger);
    const perList = ledger.filter((s) => inPeriod(s, period, today));
    const per = scrapSummary(perList);
    sub = all.rows.length ? `on hand = scrapped in − given out since ${niceDate(scrapSinceDate, today)}` : '';
    if (!all.rows.length) body = <p className="inv-empty">No scrap logged yet.</p>;
    else {
      const went = per.to.length ? per.to.map((t) => `${t.to} ${fmt(t.grams, 2)} g`).join(' · ') : 'nothing';
      const label = periodWord(period) === 'yet' ? 'All time' : periodWord(period)[0]!.toUpperCase() + periodWord(period).slice(1);
      body = (
        <>
          <div className="inv-scroll">
            <table className="inv-wide">
              <thead>
                <tr>
                  <th>Karat</th>
                  <th>In g</th>
                  <th>Out g</th>
                  <th>On hand g</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {all.rows.map((r) => (
                  <tr key={r.karat} data-testid={`scrap-row-${r.karat}`}>
                    <td>{r.karat}</td>
                    <td>{fmt(r.in, 2)}</td>
                    <td>{r.out ? fmt(r.out, 2) : '—'}</td>
                    <td className={r.in - r.out < -0.005 ? 'inv-loss' : ''}>{fmt(r.in - r.out, 2)}</td>
                    <td>{money(r.vin - r.vout)}</td>
                  </tr>
                ))}
                <tr className="inv-total">
                  <td>Total</td>
                  <td>{fmt(all.ins, 2)}</td>
                  <td>{fmt(all.outs, 2)}</td>
                  <td>{fmt(all.onhand, 2)}</td>
                  <td>{money(all.value)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="inv-ok">
            <b>{label}:</b> {fmt(per.ins, 2)} g in ({per.pieces} pieces) · {fmt(per.outs, 2)} g out → {went}
          </p>
        </>
      );
    }
  }

  const missing = kind === 'metal' && jewelers.length ? missingToday(byKind(slips, 'metal'), jewelers, today) : null;
  const missingText = !missing
    ? null
    : !missing.in.length
      ? `Today: no slips in yet — missing ${missing.missing.join(', ')}`
      : !missing.missing.length
        ? `Today: everyone's slip is in (${missing.in.join(', ')})`
        : `Today: in from ${missing.in.join(', ')} · still missing ${missing.missing.join(', ')}`;

  return (
    <section className="inv-card" aria-labelledby="inv-summary-title">
      <div className="inv-card-head">
        <h2 id="inv-summary-title">
          {K.title}
          {sub ? <span className="inv-sub">{sub}</span> : null}
        </h2>
        {showPeriod ? (
          <div className="inv-seg" role="group" aria-label="Period">
            {(['today', 'month', 'all'] as Period[]).map((p) => (
              <button key={p} type="button" aria-pressed={period === p} onClick={() => onPeriod(p)}>
                {p === 'today' ? 'Today' : p === 'month' ? 'This month' : 'All time'}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {missingText ? (
        <p className={`inv-missing${missing && missing.missing.length ? ' inv-bad' : ''}`} data-testid="missing-today">
          {missingText}
        </p>
      ) : null}
      {body}
    </section>
  );
}
