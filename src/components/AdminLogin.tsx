'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

export function AdminLogin() {
  const router = useRouter();
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? 'Login failed');
        setPasscode('');
        return;
      }
      router.refresh();
    } catch {
      setError('Network error — try again');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card">
      <h1 style={{ marginTop: 0 }}>Admin</h1>
      <div className="field">
        <label htmlFor="admin-passcode">Passcode</label>
        <input id="admin-passcode" className="input" type="password" autoComplete="off" value={passcode} onChange={(e) => setPasscode(e.target.value)} />
      </div>
      {error ? (
        <div className="notice notice--error" role="alert">
          {error}
        </div>
      ) : null}
      <button type="submit" className="btn btn--primary" disabled={busy || passcode.length === 0}>
        {busy ? 'Checking…' : 'Unlock'}
      </button>
    </form>
  );
}
