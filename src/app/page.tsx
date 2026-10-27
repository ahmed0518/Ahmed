import { headers } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { LogoutButton } from '@/components/LogoutButton';
import { OrderRows } from '@/components/OrderRows';
import { RecentChips } from '@/components/RecentChips';
import { SearchBox } from '@/components/SearchBox';
import { pageNeedsLogin, readCredential } from '@/lib/auth/credential';
import { getEnv } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { log } from '@/lib/log';
import { listUniverse, type UniverseResult } from '@/lib/orders/service';
import { PRODUCTION_TAG } from '@/lib/status/types';
import { parsePage } from '@/lib/validate';

export const dynamic = 'force-dynamic';

const PER_PAGE = 50;

export default async function HomePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const h = await headers();
  if (await pageNeedsLogin(h)) redirect('/login?next=%2F');
  const env = getEnv();
  const cred = await readCredential(h);
  const page = parsePage(typeof sp.page === 'string' ? sp.page : null) ?? 1;

  let universe: UniverseResult | null = null;
  let error: string | null = null;
  try {
    universe = await listUniverse();
  } catch (e) {
    error = e instanceof AppError ? e.message : 'Could not load orders';
    log.error('home list failed', { detail: e instanceof AppError ? (e.detail ?? e.message) : String(e) });
  }

  const now = new Date();
  const rows = universe?.rows ?? [];
  const neverSet = rows.filter((r) => r.tracking === 'never_set');
  const inProduction = rows.filter((r) => r.tracking !== 'never_set' && (r.order.tags.includes(PRODUCTION_TAG) || !r.all_done));
  const combined = [...neverSet, ...inProduction];
  const totalPages = Math.max(1, Math.ceil(combined.length / PER_PAGE));
  const start = (page - 1) * PER_PAGE;
  const slice = combined.slice(start, start + PER_PAGE);
  const sliceNever = slice.filter((r) => r.tracking === 'never_set');
  const sliceProd = slice.filter((r) => r.tracking !== 'never_set');

  return (
    <>
      <SearchBox />
      <RecentChips />

      {cred?.kind === 'staff' ? (
        <div className="muted">
          Logged in as {cred.name} · <LogoutButton className="btn--link" />
        </div>
      ) : (
        <p className="muted">
          <Link href="/login?next=%2F">Log in</Link> to update statuses.
        </p>
      )}

      {error ? (
        <div className="notice notice--error" role="alert">
          {error}. Shopify may be slow — try again in a moment.
        </div>
      ) : null}

      {universe?.truncated ? <div className="notice notice--warn">The list is cut at 500 orders per query — narrow the watch query in /admin.</div> : null}

      {(page === 1 || sliceNever.length > 0) && (
        <section className="card" aria-labelledby="never-set-title">
          <h2 id="never-set-title" className="card__title">
            Never set ({neverSet.length})
          </h2>
          <p className="muted">Orders in production that nobody has set a status on yet — oldest first.</p>
          <OrderRows rows={sliceNever} tz={env.DISPLAY_TZ} now={now} />
        </section>
      )}

      <section className="card" aria-labelledby="in-production-title">
        <h2 id="in-production-title" className="card__title">
          In production ({inProduction.length})
        </h2>
        <p className="muted">Stalest first. Red = nobody touched it for {rows[0]?.stale_after_days ?? 3} work days.</p>
        <OrderRows rows={sliceProd} tz={env.DISPLAY_TZ} now={now} />
      </section>

      {totalPages > 1 ? (
        <nav className="pager" aria-label="Pages">
          {page > 1 ? <Link href={`/?page=${page - 1}`}>← Newer</Link> : <span />}
          <span className="muted">
            Page {page} of {totalPages}
          </span>
          {page < totalPages ? <Link href={`/?page=${page + 1}`}>Older →</Link> : <span />}
        </nav>
      ) : null}

      {universe ? (
        <p className="muted">
          Checked {universe.checked_at.replace('T', ' ').replace('Z', ' UTC')} · a newly tagged order can take a few seconds to appear.
        </p>
      ) : null}
    </>
  );
}
