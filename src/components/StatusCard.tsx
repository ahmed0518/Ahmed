'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { HistoryOut, ItemOut, OrderPayload, PublicItem, PublicOrder } from '@/lib/orders/types';
import type { StaleReason } from '@/lib/status/compute';
import { viaLabel } from '@/lib/text';
import { formatAbsolute, formatMonD } from '@/lib/time';
import { RelativeAgo } from './RelativeTime';
import styles from './StatusCard.module.css';

/** A 401 on a save: the card shows one linked notice at the top, never a second per-item alert. */
class SessionExpired extends Error {
  constructor() {
    super('Session expired — log in again');
    this.name = 'SessionExpired';
  }
}

export interface StatusOption {
  id: string;
  name: string;
  done: boolean;
  waiting: boolean;
  retired: boolean;
}

/** One item as the card renders it — the public fields plus whatever a credential adds. */
type ItemView = PublicItem & Partial<Pick<ItemOut, 'attributes' | 'history' | 'via' | 'source'>>;

/** Everything the card renders, from the payload — the order-level header is derived from it too. */
interface OrderView {
  items: ItemView[];
  summary: string;
  removed: OrderPayload['removed_items'];
  hidden: OrderPayload['hidden_items'];
  last_updated_at: string | null;
  last_updated_by: string | null;
  stale: boolean;
  stale_reason: StaleReason;
  all_done: boolean;
  blocked_on: string[];
}

function toView(p: OrderPayload | PublicOrder): OrderView {
  const credentialed = 'untracked_items' in p;
  return {
    items: p.items as ItemView[],
    summary: p.summary,
    removed: credentialed ? p.removed_items : [],
    hidden: credentialed ? p.hidden_items : [],
    last_updated_at: p.last_updated_at,
    last_updated_by: p.last_updated_by,
    stale: p.stale,
    stale_reason: p.stale_reason,
    all_done: p.all_done,
    blocked_on: [...p.blocked_on],
  };
}

interface Props {
  number: string;
  initial: OrderPayload | PublicOrder;
  statuses: StatusOption[];
  canEdit: boolean;
  loginHref: string;
  tz: string;
  unreadable: boolean;
}

type Pending = 'saving' | 'saved' | 'error';

const KIND_LABEL: Record<HistoryOut['kind'], string> = { set: 'Set', confirm: 'Still here', clear: 'Cleared' };

export function StatusCard({ number, initial, statuses, canEdit, loginHref, tz, unreadable }: Props) {
  const [order, setOrder] = useState<OrderView>(() => toView(initial));
  const [pending, setPending] = useState<Record<string, Pending>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [bulkState, setBulkState] = useState<{ pending: Pending | null; message: string | null }>({ pending: null, message: null });
  const [sessionExpired, setSessionExpired] = useState(false);

  const selectable = statuses.filter((s) => !s.retired);
  const byId = new Map(statuses.map((s) => [s.id, s]));

  async function post(path: string, body: Record<string, unknown>): Promise<OrderPayload> {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status === 401) {
      setSessionExpired(true);
      throw new SessionExpired();
    }
    const data = (await res.json().catch(() => ({}))) as { error?: string } & Partial<OrderPayload>;
    if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
    return data as OrderPayload;
  }

  function markSaved(id: string) {
    setPending((p) => ({ ...p, [id]: 'saved' }));
    window.setTimeout(() => setPending((p) => (p[id] === 'saved' ? { ...p, [id]: undefined as unknown as Pending } : p)), 2500);
  }

  /** Every successful write replaces the whole view, header included, so nothing goes stale. */
  function applyResponse(next: OrderPayload) {
    setOrder(toView(next));
  }

  /**
   * One item: a status picked in the select or a "Still here" confirmation. The note typed
   * for the item travels with whichever save comes first and the field clears once it is
   * stored; on failure the text stays so nothing typed is lost.
   */
  async function changeStatus(id: string, value: string | null) {
    const previous = order;
    const note = notes[id] ?? '';
    const def = value ? byId.get(value) : undefined;
    setOrder((o) => ({
      ...o,
      items: o.items.map((i) =>
        i.line_item_id === id ? { ...i, status: value, status_name: def?.name ?? null, done: Boolean(def?.done), waiting: Boolean(def?.waiting) } : i,
      ),
    }));
    setPending((p) => ({ ...p, [id]: 'saving' }));
    setErrors((e) => ({ ...e, [id]: '' }));
    try {
      const next = await post(`/api/orders/${number}/items/${id}`, { status: value, note });
      applyResponse(next);
      markSaved(id);
      setNotes((n) => ({ ...n, [id]: '' }));
    } catch (e) {
      setOrder(previous);
      setPending((p) => ({ ...p, [id]: 'error' }));
      // the session notice at the top already carries the message and the login link
      if (!(e instanceof SessionExpired)) setErrors((er) => ({ ...er, [id]: e instanceof Error ? e.message : 'Could not save' }));
    }
  }

  async function bulk(items: Record<string, string | null>, label: string) {
    if (Object.keys(items).length === 0) return;
    const previous = order;
    setBulkState({ pending: 'saving', message: null });
    try {
      const next = await post(`/api/orders/${number}`, { items });
      applyResponse(next);
      // The order now reflects this write: an earlier per-item failure is no longer true.
      setErrors({});
      setPending({});
      setBulkState({ pending: 'saved', message: label });
      window.setTimeout(() => setBulkState((s) => (s.pending === 'saved' ? { pending: null, message: null } : s)), 2500);
    } catch (e) {
      setOrder(previous);
      if (e instanceof SessionExpired) setBulkState({ pending: null, message: null });
      else setBulkState({ pending: 'error', message: e instanceof Error ? e.message : 'Could not save' });
    }
  }

  function setAll(value: string) {
    if (!value) return;
    const items: Record<string, string | null> = {};
    for (const i of order.items) items[i.line_item_id] = value;
    const def = byId.get(value);
    void bulk(items, `All ${order.items.length} items set to ${def?.name ?? value}`);
  }

  /** Confirms every item that holds a status; the label says how many had none and were skipped. */
  function allStillHere() {
    const items: Record<string, string | null> = {};
    for (const i of order.items) if (i.status) items[i.line_item_id] = i.status;
    const confirmed = Object.keys(items).length;
    if (confirmed === 0) {
      setBulkState({ pending: 'error', message: 'No item has a status yet' });
      return;
    }
    const skipped = order.items.length - confirmed;
    void bulk(items, skipped > 0 ? `Confirmed ${confirmed} of ${order.items.length} items — ${skipped} without a status skipped` : 'Confirmed — all still here');
  }

  const busy = bulkState.pending === 'saving';
  const n = order.items.length;
  const lastUpdated = order.last_updated_at && order.last_updated_by ? { at: new Date(order.last_updated_at), by: order.last_updated_by } : null;

  return (
    <section className={`card ${styles.card}`} aria-labelledby="status-card-title">
      <h2 id="status-card-title" className="card__title" style={{ marginTop: 0 }}>
        Production Status by Product
      </h2>

      <p className={`small ${styles.summary}`} data-testid="order-summary">
        {order.summary}{' '}
        {order.stale ? <span className="badge badge--stale">stale</span> : null}{' '}
        {order.blocked_on.length > 0 ? <span className="badge badge--waiting">waiting</span> : null}{' '}
        {order.all_done ? <span className="badge badge--done">done</span> : null}
        {order.stale_reason === 'shipped' ? <span className="muted"> · shipped</span> : null}
      </p>
      {lastUpdated ? (
        <p className={`muted ${styles.orderMeta}`} data-testid="order-last-updated">
          Last updated {formatAbsolute(lastUpdated.at, tz)} by {lastUpdated.by}
          <RelativeAgo iso={order.last_updated_at ?? ''} tz={tz} />
        </p>
      ) : null}

      {unreadable ? <div className="notice notice--error">Status data unreadable — contact admin. The next save starts fresh.</div> : null}

      {sessionExpired ? (
        <div className="notice notice--error" role="alert">
          Session expired —{' '}
          <Link href={loginHref} className="action-link">
            log in
          </Link>{' '}
          to keep updating.
        </div>
      ) : null}

      {!canEdit ? (
        <div className="notice notice--warn">
          <Link href={loginHref} className="action-link">
            Log in to update
          </Link>{' '}
          — statuses are read-only until you pick your name and PIN.
        </div>
      ) : null}

      {canEdit && n > 0 ? (
        <div className={styles.bulk}>
          <label className="visually-hidden" htmlFor="set-all">
            Set all {n} items to
          </label>
          <select
            id="set-all"
            className="select-status"
            value=""
            disabled={busy}
            onChange={(e) => setAll(e.target.value)}
            aria-label={`Set all ${n} items to`}
          >
            <option value="">Set all {n} {n === 1 ? 'item' : 'items'} to…</option>
            {selectable.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button type="button" className="btn" disabled={busy} onClick={allStillHere}>
            All still here
          </button>
          {bulkState.pending === 'saving' ? <span className="muted">Saving…</span> : null}
          {bulkState.pending === 'saved' ? <span className="muted" style={{ color: 'var(--ok)' }}>{bulkState.message ?? 'Saved'}</span> : null}
          {bulkState.pending === 'error' ? (
            <span className="notice notice--error" role="alert">
              {bulkState.message}
            </span>
          ) : null}
        </div>
      ) : null}

      {n === 0 ? <p className="muted">No production items on this order.</p> : null}

      {order.items.map((item) => {
        const own = item.status ? byId.get(item.status) : undefined;
        const options = own && own.retired ? [...selectable, own] : selectable;
        const state = pending[item.line_item_id];
        const err = errors[item.line_item_id];
        const attrs = item.attributes ? Object.entries(item.attributes) : [];
        const history = item.history ? [...item.history].reverse() : [];
        return (
          <div key={item.line_item_id} className={styles.item} data-testid={`item-${item.line_item_id}`}>
            <div className={styles.pillRow}>
              <span className="pill">{item.label}</span>
              {item.stale ? <span className="badge badge--stale">stale</span> : null}
              {item.waiting ? <span className="badge badge--waiting">waiting</span> : null}
              {item.done ? <span className="badge badge--done">done</span> : null}
            </div>
            {attrs.length > 0 ? (
              <div className={`muted ${styles.attrs}`}>
                {attrs.map(([k, v]) => (
                  <span key={k}>
                    {k}: {v}
                  </span>
                ))}
              </div>
            ) : null}
            <label className="visually-hidden" htmlFor={`status-${item.line_item_id}`}>
              Status for {item.label}
            </label>
            <select
              id={`status-${item.line_item_id}`}
              className="select-status"
              value={item.status ?? ''}
              disabled={!canEdit || state === 'saving' || busy}
              onChange={(e) => void changeStatus(item.line_item_id, e.target.value || null)}
            >
              <option value="">Select production status…</option>
              {options.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            {canEdit ? (
              <div className={styles.stillHere}>
                <input
                  className="input"
                  placeholder="Note (optional)"
                  maxLength={200}
                  value={notes[item.line_item_id] ?? ''}
                  onChange={(e) => setNotes((nn) => ({ ...nn, [item.line_item_id]: e.target.value }))}
                  aria-label={`Note for ${item.label}`}
                />
                <button
                  type="button"
                  className="btn btn--small"
                  disabled={!item.status || state === 'saving' || busy}
                  onClick={() => void changeStatus(item.line_item_id, item.status)}
                  title="Confirm the current status without changing it"
                >
                  Still here
                </button>
              </div>
            ) : null}
            <div className={`muted ${styles.meta}`} data-testid={`last-updated-${item.line_item_id}`}>
              {state === 'saving' ? (
                'Saving…'
              ) : (
                <>
                  {state === 'saved' ? 'Saved · ' : ''}
                  <LastUpdated item={item} tz={tz} />
                </>
              )}
            </div>
            {err ? (
              <div className="notice notice--error" role="alert">
                {err}
              </div>
            ) : null}
            {history.length > 0 ? (
              <details>
                <summary>History ({history.length})</summary>
                <ul className="history">
                  {history.map((h, idx) => (
                    <li key={`${h.at}-${idx}`}>
                      <strong>{KIND_LABEL[h.kind]}</strong>
                      {h.status_name ? ` → ${h.status_name}` : h.kind === 'clear' ? ' (no status)' : ''} · {h.by}
                      {h.via && !h.via.startsWith('web:') ? ` (via ${viaLabel(h.via)})` : ''} · {formatAbsolute(new Date(h.at), tz)}
                      {h.note ? ` · “${h.note}”` : ''}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        );
      })}

      {order.hidden.length > 0 ? (
        <details className={styles.collapsed}>
          <summary>
            {order.hidden.length} non-production {order.hidden.length === 1 ? 'item' : 'items'} hidden
          </summary>
          <ul className="history">
            {order.hidden.map((h) => (
              <li key={h.line_item_id}>{h.title}</li>
            ))}
          </ul>
        </details>
      ) : null}

      {order.removed.length > 0 ? (
        <details className={styles.collapsed} data-testid="removed-items">
          <summary>
            {order.removed.length} removed {order.removed.length === 1 ? 'item' : 'items'}
          </summary>
          <ul className="history">
            {order.removed.map((r) => (
              <li key={r.line_item_id}>
                {r.title} — {r.status_name ?? 'no status'} (read-only, removed from the order)
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

function LastUpdated({ item, tz }: { item: ItemView; tz: string }) {
  if (!item.updated_at || !item.updated_by) return <>Not set yet</>;
  const when = new Date(item.updated_at);
  const via = item.via && !item.via.startsWith('web:') ? ` (via ${viaLabel(item.via)})` : '';
  if (item.status === null) {
    return (
      <>
        Not set (cleared by {item.updated_by}
        {via}, {formatMonD(when, tz)})
      </>
    );
  }
  return (
    <>
      Last updated {formatAbsolute(when, tz)} by {item.updated_by}
      {via}
    </>
  );
}
