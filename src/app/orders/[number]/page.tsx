import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { RememberRecent } from '@/components/RecentChips';
import { StatusCard } from '@/components/StatusCard';
import { pageNeedsLogin, readCredential } from '@/lib/auth/credential';
import { getEnv } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { log } from '@/lib/log';
import { readOrder, readOrderPublic } from '@/lib/orders/service';
import type { OrderPayload, PublicOrder } from '@/lib/orders/types';
import { publicStatuses } from '@/lib/settings/model';
import { getSettings } from '@/lib/settings/store';
import { formatAbsolute, formatDateValue } from '@/lib/time';
import { parseOrderNumber } from '@/lib/validate';

export const dynamic = 'force-dynamic';

type Loaded =
  | { kind: 'full'; payload: OrderPayload }
  | { kind: 'public'; body: PublicOrder }
  | { kind: 'untracked' }
  | { kind: 'not_found' }
  | { kind: 'error'; message: string };

async function load(number: string, credentialed: boolean): Promise<Loaded> {
  try {
    if (credentialed) return { kind: 'full', payload: await readOrder(number) };
    const body = await readOrderPublic(number);
    if ('tracked' in body) return { kind: 'untracked' };
    return { kind: 'public', body };
  } catch (e) {
    if (e instanceof AppError && e.status === 404) return { kind: 'not_found' };
    log.error('order page failed', { order: number, detail: e instanceof AppError ? (e.detail ?? e.message) : String(e) });
    return { kind: 'error', message: e instanceof AppError ? e.message : 'Could not load the order' };
  }
}

export default async function OrderPage({ params }: { params: Promise<{ number: string }> }) {
  const { number: raw } = await params;
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    /* keep raw */
  }
  const number = parseOrderNumber(decoded);
  if (!number) notFound();

  const h = await headers();
  const loginHref = `/login?next=${encodeURIComponent(`/orders/${number}`)}`;
  if (await pageNeedsLogin(h)) redirect(loginHref);
  const env = getEnv();
  const cred = await readCredential(h);
  const staffName = cred?.kind === 'staff' ? cred.name : null;
  const tz = env.DISPLAY_TZ;
  const now = new Date();

  let statuses: ReturnType<typeof publicStatuses> = [];
  let settingsError = false;
  try {
    statuses = publicStatuses(await getSettings());
  } catch (e) {
    settingsError = true;
    log.error('settings load failed', { detail: e instanceof AppError ? (e.detail ?? e.message) : String(e) });
  }

  const loaded = settingsError ? ({ kind: 'error', message: 'Shopify request failed' } as const) : await load(number, staffName !== null);
  if (loaded.kind === 'not_found') notFound();

  const header = (
    <div className="row" style={{ justifyContent: 'space-between' }}>
      <h1 style={{ margin: 0 }}>Order #{number}</h1>
      {staffName ? (
        <span className="muted">
          Updating as {staffName} —{' '}
          <Link href={loginHref} className="action-link">
            Switch
          </Link>
        </span>
      ) : null}
    </div>
  );

  if (loaded.kind === 'error') {
    return (
      <div className="card">
        {header}
        <div className="notice notice--error" role="alert">
          {loaded.message}. Try again in a moment.
        </div>
      </div>
    );
  }

  if (loaded.kind === 'untracked') {
    return (
      <>
        <RememberRecent number={number} />
        <div className="card">
          {header}
          <p>This order is not tracked for production yet.</p>
          <p className="muted">
            <Link href={loginHref} className="action-link">
              Log in
            </Link>{' '}
            to see its items and set the first status.
          </p>
        </div>
      </>
    );
  }

  const status = loaded.kind === 'full' ? loaded.payload : loaded.body;
  const full = loaded.kind === 'full' ? loaded.payload : null;

  // The order-level status line (summary, badges, "Last updated … by …") lives in StatusCard,
  // which re-renders it from every write's response so the page never shows two states.
  return (
    <>
      <RememberRecent number={number} />
      <div className="card">
        {header}
        {full ? (
          <p className="muted">
            <a href={full.order.admin_url} target="_blank" rel="noreferrer" className="action-link">
              Open in Shopify
            </a>{' '}
            · ordered {formatAbsolute(new Date(full.order.created_at), tz, now)} · {full.order.fulfillment_status.toLowerCase().replace(/_/g, ' ')}
            {full.order.closed ? ' · archived' : ''}
            {full.order.cancelled_at ? ' · cancelled' : ''}
          </p>
        ) : null}
        {full && (full.context.production_date || full.context.due_date || full.context.custody || full.context.give_to) ? (
          <dl className="small" style={{ margin: '8px 0' }}>
            {full.context.production_date ? (
              // the metafield's own name: its free-text value usually starts with "Ships by" itself
              <div>
                <strong>Production date:</strong> {full.context.production_date}
              </div>
            ) : null}
            {full.context.due_date ? (
              <div>
                <strong>Promised:</strong> {formatDateValue(full.context.due_date, now)}
              </div>
            ) : null}
            {full.context.custody ? (
              <div>
                <strong>Who has it:</strong> <span className="prewrap">{full.context.custody}</span>
              </div>
            ) : null}
            {full.context.give_to ? (
              <div>
                <strong>Give to:</strong> {full.context.give_to}
              </div>
            ) : null}
          </dl>
        ) : null}
      </div>

      <StatusCard
        number={number}
        initial={status}
        statuses={statuses}
        canEdit={staffName !== null}
        loginHref={loginHref}
        tz={tz}
        unreadable={full?.status_data_unreadable === true}
      />
    </>
  );
}
