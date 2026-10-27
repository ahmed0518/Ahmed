'use client';

import { useEffect, useState } from 'react';
import { relativeDays, relativeDaysOrNull } from '@/lib/time';

/**
 * Server renders the absolute fallback (no hydration mismatch); after mount the client
 * swaps in `today` / `yesterday` / `N days ago` (14 days or more stays absolute).
 */
export function RelativeTime({ iso, tz, fallback }: { iso: string; tz: string; fallback: string }) {
  const [label, setLabel] = useState(fallback);
  useEffect(() => {
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) setLabel(relativeDays(d, new Date(), tz));
  }, [iso, tz]);
  return (
    <time dateTime={iso} title={fallback}>
      {label}
    </time>
  );
}

/**
 * ` (today)` / ` (3 days ago)` after an absolute time that is already on the line. Nothing
 * on the server (the relative label depends on the client's clock) and nothing from 14 days
 * on, when it would only repeat the date next to it.
 */
export function RelativeAgo({ iso, tz }: { iso: string; tz: string }) {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    const d = new Date(iso);
    setLabel(Number.isNaN(d.getTime()) ? null : relativeDaysOrNull(d, new Date(), tz));
  }, [iso, tz]);
  if (label === null) return null;
  return (
    <>
      {' '}
      (<time dateTime={iso}>{label}</time>)
    </>
  );
}
