'use client';

import { useEffect, useState } from 'react';
import { relativeDays } from '@/lib/time';

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
