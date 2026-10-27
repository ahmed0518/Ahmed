'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { parseOrderNumber } from '@/lib/validate';

export function SearchBox() {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    const number = parseOrderNumber(value);
    if (!number) {
      setError('Enter an order number, e.g. 251548');
      return;
    }
    setError(null);
    router.push(`/orders/${number}`);
  }

  return (
    <form onSubmit={submit} role="search" className="card">
      <label htmlFor="order-search" className="card__title" style={{ display: 'block' }}>
        Find an order
      </label>
      <div className="row">
        <input
          id="order-search"
          className="input"
          style={{ flex: '1 1 160px' }}
          inputMode="numeric"
          autoFocus
          autoComplete="off"
          placeholder="251548 or #251548"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-describedby={error ? 'order-search-error' : undefined}
        />
        <button type="submit" className="btn btn--primary">
          Open
        </button>
      </div>
      {error ? (
        <div id="order-search-error" className="notice notice--error">
          {error}
        </div>
      ) : null}
    </form>
  );
}
