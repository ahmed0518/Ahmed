import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { InventoryApp } from '@/components/inventory/InventoryApp';
import { getEnv } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { buildPayload, viewerFor } from '@/lib/inventory/service';
import { inventoryEnabled } from '@/lib/inventory/store';
import { log } from '@/lib/log';
import { getStaff } from '@/lib/settings/store';

export const dynamic = 'force-dynamic';

/**
 * /inventory (SPEC §14): 404 until a store is configured; a staff login is always required
 * (the ledgers are not public); then the four tiles for the sections this person may see.
 */
export default async function InventoryPage() {
  if (!inventoryEnabled()) notFound();
  const h = await headers();
  const env = getEnv();
  try {
    const { viewer, settings } = await viewerFor(h);
    if (viewer.kind === 'anonymous') redirect('/login?next=%2Finventory');
    const payload = await buildPayload(viewer, settings, env.DISPLAY_TZ);
    let staff: { id: string; name: string }[] = [];
    if (viewer.owner) {
      const roster = await getStaff();
      staff = roster.staff.filter((s) => s.active).map((s) => ({ id: s.id, name: s.name }));
    }
    return <InventoryApp initial={payload} access={viewer.owner ? settings.access : {}} staff={staff} syncEnabled={env.MONDAY_API_TOKEN !== null} />;
  } catch (e) {
    if (e && typeof e === 'object' && 'digest' in e && String((e as { digest?: unknown }).digest).startsWith('NEXT_REDIRECT')) throw e;
    log.error('inventory page failed', { detail: e instanceof AppError ? (e.detail ?? e.message) : String(e) });
    return (
      <div className="card">
        <h1 style={{ marginTop: 0 }}>Inventory</h1>
        <div className="notice notice--error" role="alert">
          Could not load the inventory. Try again in a moment.
        </div>
        <p className="muted">
          <Link href="/" className="action-link">
            ← Back to orders
          </Link>
        </p>
      </div>
    );
  }
}
