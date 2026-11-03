/** Small display helpers shared by the inventory components (browser-safe). */
export { fmt, money } from '@/lib/inventory/compute';

/** `2026-10-21` → `Oct 21` (year appended when not the current one). */
export function niceDate(iso: string | null | undefined, today: string): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso || '—';
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: iso.slice(0, 4) === today.slice(0, 4) ? undefined : 'numeric' });
}

/** An ISO timestamp → `Oct 21, 3:12 PM`. */
export function niceTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, init);
  const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string } & T;
  if (!res.ok) {
    const err = new Error(data.error ?? `Request failed (${res.status})`) as Error & { status: number; code?: string };
    err.status = res.status;
    err.code = data.code;
    throw err;
  }
  return data;
}
