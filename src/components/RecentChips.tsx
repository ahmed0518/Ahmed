'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

const KEY = 'trax.recentOrders';
const MAX = 5;

function readRecent(): string[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((n): n is string => typeof n === 'string' && /^\d{1,12}$/.test(n)).slice(0, MAX);
  } catch {
    return [];
  }
}

function writeRecent(list: string[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    /* best effort */
  }
}

/** "Recent" chips for the last five orders opened on this device (localStorage, best effort). */
export function RecentChips() {
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => {
    setRecent(readRecent());
  }, []);
  if (recent.length === 0) return null;
  return (
    <div className="card">
      <div className="muted">Recent on this device</div>
      <div className="chips">
        {recent.map((n) => (
          <Link key={n} href={`/orders/${n}`} className="chip">
            #{n}
          </Link>
        ))}
      </div>
    </div>
  );
}

/** Records the order being viewed. Renders nothing. */
export function RememberRecent({ number }: { number: string }) {
  useEffect(() => {
    const list = [number, ...readRecent().filter((n) => n !== number)];
    writeRecent(list);
  }, [number]);
  return null;
}
