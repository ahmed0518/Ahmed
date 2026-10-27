import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { AdminLogin } from '@/components/AdminLogin';
import { AdminPanel } from '@/components/AdminPanel';
import { settingsForm, staffView } from '@/lib/admin/model';
import { isAdmin, pageNeedsLogin } from '@/lib/auth/credential';
import { getEnv } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { log } from '@/lib/log';
import { loadShopData } from '@/lib/settings/store';

export const dynamic = 'force-dynamic';

/**
 * 404 until ADMIN_PASSCODE (≥ 16 chars) is set; with READ_TOKEN set a staff login first, like
 * every page but /login, /agents and /llms.txt (SPEC §5); passcode form; then the settings +
 * roster UI.
 */
export default async function AdminPage() {
  const h = await headers();
  const env = getEnv();
  if (!env.ADMIN_PASSCODE) notFound();
  if (await pageNeedsLogin(h)) redirect('/login?next=%2Fadmin');
  if (!isAdmin(h)) return <AdminLogin />;

  try {
    const data = await loadShopData({ fresh: true });
    return (
      <AdminPanel
        settings={settingsForm(data.settings)}
        staff={staffView(data.staff)}
        settingsStored={data.settingsStored}
        staffStored={data.staffStored}
      />
    );
  } catch (e) {
    log.error('admin page failed', { detail: e instanceof AppError ? (e.detail ?? e.message) : String(e) });
    return (
      <div className="card">
        <h1 style={{ marginTop: 0 }}>Admin</h1>
        <div className="notice notice--error" role="alert">
          Could not load settings from Shopify. Try again in a moment.
        </div>
      </div>
    );
  }
}
