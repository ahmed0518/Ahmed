import type { ProxyTrust } from '@/lib/env';

/**
 * CSRF check for cookie-authenticated mutating requests (SPEC §5): allowed when
 * `Sec-Fetch-Site` is `same-origin` or `none`; when that header is absent, `Origin` must
 * match the app's host. Bearer requests skip this. Client-IP and host resolution only
 * believe a proxy header under the `TRUST_PROXY` mode the deployment declared.
 */

export interface HeaderReader {
  get(name: string): string | null;
}

export type { ProxyTrust };

/** The host this request was addressed to; `x-forwarded-host` only when a proxy is trusted. */
export function requestHost(headers: HeaderReader, trust: ProxyTrust = 'none'): string | null {
  const forwarded = trust === 'none' ? null : headers.get('x-forwarded-host');
  const host = (forwarded ? forwarded.split(',')[0] : headers.get('host')) ?? null;
  return host ? host.trim().toLowerCase() : null;
}

export function csrfOk(headers: HeaderReader, trust: ProxyTrust = 'none'): boolean {
  const site = headers.get('sec-fetch-site');
  if (site !== null) {
    const v = site.trim().toLowerCase();
    return v === 'same-origin' || v === 'none';
  }
  const origin = headers.get('origin');
  if (!origin) return false;
  const host = requestHost(headers, trust);
  if (!host) return false;
  try {
    return new URL(origin).host.toLowerCase() === host;
  } catch {
    return false;
  }
}

function hop(value: string | null, which: 'first' | 'last'): string | null {
  if (!value) return null;
  const parts = value
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const pick = which === 'first' ? parts[0] : parts[parts.length - 1];
  return pick ? pick.slice(0, 64) : null;
}

/**
 * Client IP for the per-IP limiters. `vercel`: the platform overwrites `x-real-ip` /
 * `x-vercel-forwarded-for`, so they are authoritative. `forwarded`: exactly one reverse proxy
 * sits in front of the app and appends the peer address to `x-forwarded-for`, so the LAST
 * entry is the client (the first one can be supplied by the client itself). `none`: nothing
 * is trusted and every caller shares the key `unknown`.
 */
export function clientIp(headers: HeaderReader, trust: ProxyTrust): string {
  let ip: string | null = null;
  if (trust === 'vercel') ip = hop(headers.get('x-real-ip'), 'first') ?? hop(headers.get('x-vercel-forwarded-for'), 'first');
  else if (trust === 'forwarded') ip = hop(headers.get('x-forwarded-for'), 'last');
  return ip ?? 'unknown';
}
