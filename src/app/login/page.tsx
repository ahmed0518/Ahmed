import { headers } from 'next/headers';
import { LoginForm } from '@/components/LoginForm';
import { readCredentialSafe } from '@/lib/auth/credential';
import { AppError } from '@/lib/errors';
import { log } from '@/lib/log';
import { getStaff } from '@/lib/settings/store';
import { safeNextPath } from '@/lib/validate';

export const dynamic = 'force-dynamic';

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const next = safeNextPath(typeof sp.next === 'string' ? sp.next : null);
  const h = await headers();
  const cred = await readCredentialSafe(h); // a failed roster read is reported by the block below, never a 500
  let staff: { id: string; name: string }[] = [];
  let error: string | null = null;
  try {
    const roster = await getStaff();
    staff = roster.staff.filter((s) => s.active).map((s) => ({ id: s.id, name: s.name }));
  } catch (e) {
    error = 'Could not load the staff list — Shopify may be slow. Try again in a moment.';
    log.error('login page roster failed', { detail: e instanceof AppError ? (e.detail ?? e.message) : String(e) });
  }
  if (error) {
    return (
      <div className="card">
        <h1 style={{ marginTop: 0 }}>Log in</h1>
        <div className="notice notice--error" role="alert">
          {error}
        </div>
      </div>
    );
  }
  return <LoginForm staff={staff} next={next} currentName={cred?.kind === 'staff' ? cred.name : null} />;
}
