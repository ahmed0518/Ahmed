'use client';

import { useState, type FormEvent } from 'react';

interface Props {
  staff: { id: string; name: string }[];
  next: string;
  currentName: string | null;
}

export function LoginForm({ staff, next, currentName }: Props) {
  const [id, setId] = useState(staff[0]?.id ?? '');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!id) {
      setError('Pick your name');
      return;
    }
    if (!/^\d{4,8}$/.test(pin)) {
      setError('PIN must be 4–8 digits');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, pin }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
      if (!res.ok) {
        const retry = res.headers.get('Retry-After');
        setError(
          res.status === 429 && retry
            ? `${data.error ?? 'Locked'} (about ${Math.ceil(Number(retry) / 60)} min)`
            : (data.error ?? 'Login failed'),
        );
        setPin('');
        return;
      }
      window.location.assign(next);
    } catch {
      setError('Network error — try again');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card" aria-labelledby="login-title">
      <h1 id="login-title" style={{ marginTop: 0 }}>
        Log in
      </h1>
      {currentName ? <p className="muted">Currently updating as {currentName}. Pick another name to switch.</p> : null}
      {staff.length === 0 ? (
        <div className="notice notice--warn">No staff names yet. Open /admin to add names and PINs.</div>
      ) : (
        <>
          <div className="field">
            <label htmlFor="login-name">Your name</label>
            <select id="login-name" className="select-status" value={id} onChange={(e) => setId(e.target.value)}>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="login-pin">PIN</label>
            <input
              id="login-pin"
              className="input"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              pattern="[0-9]*"
              maxLength={8}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              aria-describedby={error ? 'login-error' : undefined}
            />
          </div>
          {error ? (
            <div id="login-error" className="notice notice--error" role="alert">
              {error}
            </div>
          ) : null}
          <button type="submit" className="btn btn--primary" disabled={busy} style={{ width: '100%' }}>
            {busy ? 'Checking…' : 'Log in'}
          </button>
        </>
      )}
    </form>
  );
}
