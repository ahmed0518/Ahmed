'use client';

import { useState, type FormEvent } from 'react';
import type { SettingsForm, StaffView } from '@/lib/admin/model';

interface Props {
  settings: SettingsForm;
  staff: StaffView[];
  settingsStored: boolean;
  staffStored: boolean;
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

async function call<T>(path: string, method: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

export function AdminPanel(props: Props) {
  const [form, setForm] = useState<SettingsForm>(props.settings);
  const [hideText, setHideText] = useState(props.settings.hide_items_matching.join('\n'));
  const [newStatus, setNewStatus] = useState('');
  const [settingsMsg, setSettingsMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);

  const [staff, setStaff] = useState<StaffView[]>(props.staff);
  const [staffMsg, setStaffMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pinEdit, setPinEdit] = useState<{ id: string; pin: string } | null>(null);
  const [renameEdit, setRenameEdit] = useState<{ id: string; name: string } | null>(null);
  const [add, setAdd] = useState({ name: '', pin: '', active: true });

  function moveStatus(index: number, dir: -1 | 1) {
    setForm((f) => {
      const list = [...f.statuses];
      const target = index + dir;
      if (target < 0 || target >= list.length) return f;
      const a = list[index];
      const b = list[target];
      if (!a || !b) return f;
      list[index] = b;
      list[target] = a;
      return { ...f, statuses: list };
    });
  }

  function updateStatus(index: number, patch: Partial<SettingsForm['statuses'][number]>) {
    setForm((f) => ({ ...f, statuses: f.statuses.map((s, i) => (i === index ? { ...s, ...patch } : s)) }));
  }

  function addStatus() {
    const name = newStatus.trim();
    if (!name) return;
    setForm((f) => ({ ...f, statuses: [...f.statuses, { id: null, name, done: false, waiting: false, retired: false }] }));
    setNewStatus('');
  }

  async function saveSettings(e: FormEvent) {
    e.preventDefault();
    setSavingSettings(true);
    setSettingsMsg(null);
    try {
      const body = { ...form, hide_items_matching: hideText.split('\n').map((s) => s.trim()).filter(Boolean) };
      const data = await call<{ settings: SettingsForm }>('/api/admin/settings', 'PUT', body);
      setForm(data.settings);
      setHideText(data.settings.hide_items_matching.join('\n'));
      setSettingsMsg({ ok: true, text: 'Saved' });
    } catch (err) {
      setSettingsMsg({ ok: false, text: err instanceof Error ? err.message : 'Could not save' });
    } finally {
      setSavingSettings(false);
    }
  }

  async function staffAction(body: Record<string, unknown>, okText: string) {
    setStaffMsg(null);
    try {
      const data = await call<{ staff: StaffView[] }>('/api/admin/staff', 'POST', body);
      setStaff(data.staff);
      setStaffMsg({ ok: true, text: okText });
      return true;
    } catch (err) {
      setStaffMsg({ ok: false, text: err instanceof Error ? err.message : 'Could not save' });
      return false;
    }
  }

  async function submitAdd(e: FormEvent) {
    e.preventDefault();
    if (await staffAction({ action: 'add', name: add.name, pin: add.pin, active: add.active }, `Added ${add.name.trim()}`)) {
      setAdd({ name: '', pin: '', active: true });
    }
  }

  return (
    <>
      <h1>Admin</h1>
      <p className="muted">
        Settings live in the Shopify shop metafields <code>trax_production.settings</code> ({props.settingsStored ? 'stored' : 'using defaults until saved'}) and{' '}
        <code>trax_production.staff</code> ({props.staffStored ? 'stored' : 'empty until the first name is added'}). PIN hashes are never shown here.
      </p>

      <form onSubmit={saveSettings} className="card" aria-labelledby="statuses-title">
        <h2 id="statuses-title" className="card__title" style={{ marginTop: 0 }}>
          Statuses
        </h2>
        <p className="muted">Dropdown order top to bottom. Rename changes the label only; retire hides a status from new selections. Statuses are never deleted.</p>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Done</th>
                <th>Waiting</th>
                <th>Retired</th>
                <th>Order</th>
              </tr>
            </thead>
            <tbody>
              {form.statuses.map((s, i) => (
                <tr key={s.id ?? `new-${i}`}>
                  <td>
                    <input
                      className="input"
                      style={{ minHeight: 40, minWidth: 160 }}
                      value={s.name}
                      maxLength={60}
                      onChange={(e) => updateStatus(i, { name: e.target.value })}
                      aria-label={`Name of status ${s.id ?? 'new'}`}
                    />
                    {s.id ? <div className="muted">id: {s.id}</div> : <div className="muted">new</div>}
                  </td>
                  <td>
                    <input type="checkbox" checked={s.done} onChange={(e) => updateStatus(i, { done: e.target.checked })} aria-label={`${s.name} is a finishing status`} />
                  </td>
                  <td>
                    <input type="checkbox" checked={s.waiting} onChange={(e) => updateStatus(i, { waiting: e.target.checked })} aria-label={`${s.name} means waiting on parts`} />
                  </td>
                  <td>
                    <input type="checkbox" checked={s.retired} onChange={(e) => updateStatus(i, { retired: e.target.checked })} aria-label={`${s.name} is retired`} />
                  </td>
                  <td>
                    <button type="button" className="btn btn--small" onClick={() => moveStatus(i, -1)} disabled={i === 0} aria-label={`Move ${s.name} up`}>
                      ↑
                    </button>{' '}
                    <button type="button" className="btn btn--small" onClick={() => moveStatus(i, 1)} disabled={i === form.statuses.length - 1} aria-label={`Move ${s.name} down`}>
                      ↓
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <input className="input" style={{ flex: '1 1 160px' }} placeholder="New status name" value={newStatus} maxLength={60} onChange={(e) => setNewStatus(e.target.value)} aria-label="New status name" />
          <button type="button" className="btn" onClick={addStatus}>
            Add status
          </button>
        </div>

        <h2 className="card__title">Staleness</h2>
        <div className="field">
          <label htmlFor="stale-days">Stale after (work days without an update)</label>
          <input
            id="stale-days"
            className="input input--inline"
            type="number"
            min={0}
            max={365}
            value={form.stale_after_days}
            onChange={(e) => setForm((f) => ({ ...f, stale_after_days: Number(e.target.value) }))}
          />
        </div>
        <div className="field">
          <span className="label">Work days</span>
          <div className="row">
            {DAY_NAMES.map((d, i) => {
              const day = i + 1;
              const on = form.work_days.includes(day);
              return (
                <label key={d} className="chip" style={{ cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        work_days: e.target.checked ? [...f.work_days, day].sort((a, b) => a - b) : f.work_days.filter((x) => x !== day),
                      }))
                    }
                  />{' '}
                  {d}
                </label>
              );
            })}
          </div>
        </div>
        <div className="field">
          <label htmlFor="hide-patterns">Hide items whose title contains (one per line, not regex)</label>
          <textarea id="hide-patterns" className="input" value={hideText} onChange={(e) => setHideText(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="watch-query">Watch query (Shopify order search; matches form the &quot;never set&quot; list; empty disables)</label>
          <input id="watch-query" className="input" value={form.watch_query} maxLength={500} onChange={(e) => setForm((f) => ({ ...f, watch_query: e.target.value }))} />
        </div>
        {settingsMsg ? (
          <div className={`notice ${settingsMsg.ok ? 'notice--ok' : 'notice--error'}`} role="status">
            {settingsMsg.text}
          </div>
        ) : null}
        <button type="submit" className="btn btn--primary" disabled={savingSettings}>
          {savingSettings ? 'Saving…' : 'Save settings'}
        </button>
      </form>

      <section className="card" aria-labelledby="staff-title">
        <h2 id="staff-title" className="card__title" style={{ marginTop: 0 }}>
          Staff
        </h2>
        <p className="muted">First names or nicknames only. Reset PIN and Deactivate log that person out everywhere within 30 seconds.</p>
        <div className="table-wrap">
          <table className="table" data-testid="staff-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Active</th>
                <th>PIN set</th>
                <th>Locked</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {staff.map((s) => (
                <tr key={s.id}>
                  <td>
                    {renameEdit?.id === s.id ? (
                      <span className="row">
                        <input className="input input--inline" style={{ minHeight: 36 }} value={renameEdit.name} maxLength={30} onChange={(e) => setRenameEdit({ id: s.id, name: e.target.value })} aria-label={`New name for ${s.name}`} />
                        <button
                          type="button"
                          className="btn btn--small"
                          onClick={async () => {
                            if (await staffAction({ action: 'rename', id: s.id, name: renameEdit.name }, 'Renamed')) setRenameEdit(null);
                          }}
                        >
                          Save
                        </button>
                        <button type="button" className="btn btn--small" onClick={() => setRenameEdit(null)}>
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <>
                        {s.name} <span className="muted">({s.id})</span>
                      </>
                    )}
                  </td>
                  <td>{s.active ? 'yes' : 'no'}</td>
                  <td>{s.pin_set ? 'yes' : 'no'}</td>
                  <td>{s.locked ? 'yes' : 'no'}</td>
                  <td>
                    {pinEdit?.id === s.id ? (
                      <span className="row">
                        <input
                          className="input input--inline"
                          style={{ minHeight: 36, width: 120 }}
                          type="password"
                          inputMode="numeric"
                          autoComplete="off"
                          maxLength={8}
                          placeholder="New PIN"
                          value={pinEdit.pin}
                          onChange={(e) => setPinEdit({ id: s.id, pin: e.target.value.replace(/\D/g, '') })}
                          aria-label={`New PIN for ${s.name}`}
                        />
                        <button
                          type="button"
                          className="btn btn--small"
                          onClick={async () => {
                            if (await staffAction({ action: 'set_pin', id: s.id, pin: pinEdit.pin }, `PIN set for ${s.name}`)) setPinEdit(null);
                          }}
                        >
                          Save PIN
                        </button>
                        <button type="button" className="btn btn--small" onClick={() => setPinEdit(null)}>
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <span className="row">
                        <button type="button" className="btn btn--small" onClick={() => setPinEdit({ id: s.id, pin: '' })}>
                          {s.pin_set ? 'Reset PIN' : 'Set PIN'}
                        </button>
                        <button type="button" className="btn btn--small" onClick={() => setRenameEdit({ id: s.id, name: s.name })}>
                          Rename
                        </button>
                        {s.active ? (
                          <button type="button" className="btn btn--small" onClick={() => void staffAction({ action: 'deactivate', id: s.id }, `${s.name} deactivated`)}>
                            Deactivate
                          </button>
                        ) : (
                          <button type="button" className="btn btn--small" onClick={() => void staffAction({ action: 'activate', id: s.id }, `${s.name} activated`)}>
                            Activate
                          </button>
                        )}
                        {s.locked ? (
                          <button type="button" className="btn btn--small" onClick={() => void staffAction({ action: 'clear_lock', id: s.id }, `Lock cleared for ${s.name}`)}>
                            Clear lock
                          </button>
                        ) : null}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {staff.length === 0 ? (
                <tr>
                  <td colSpan={5} className="muted">
                    No staff yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <form onSubmit={submitAdd} style={{ marginTop: 16 }} aria-labelledby="add-staff-title">
          <h3 id="add-staff-title" className="small" style={{ margin: '0 0 8px' }}>
            Add a person
          </h3>
          <div className="row">
            <input className="input" style={{ flex: '1 1 140px' }} placeholder="Name" maxLength={30} value={add.name} onChange={(e) => setAdd((a) => ({ ...a, name: e.target.value }))} aria-label="Name" />
            <input
              className="input"
              style={{ flex: '1 1 120px' }}
              type="password"
              inputMode="numeric"
              autoComplete="off"
              placeholder="PIN (4–8 digits)"
              maxLength={8}
              value={add.pin}
              onChange={(e) => setAdd((a) => ({ ...a, pin: e.target.value.replace(/\D/g, '') }))}
              aria-label="PIN"
            />
            <label className="chip" style={{ cursor: 'pointer' }}>
              <input type="checkbox" checked={add.active} onChange={(e) => setAdd((a) => ({ ...a, active: e.target.checked }))} /> Active
            </label>
            <button type="submit" className="btn btn--primary" disabled={!add.name.trim() || !/^\d{4,8}$/.test(add.pin)}>
              Add
            </button>
          </div>
        </form>
        {staffMsg ? (
          <div className={`notice ${staffMsg.ok ? 'notice--ok' : 'notice--error'}`} role="status">
            {staffMsg.text}
          </div>
        ) : null}
      </section>
    </>
  );
}
