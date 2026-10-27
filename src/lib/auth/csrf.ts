/**
 * CSRF check for cookie-authenticated mutating requests (SPEC §5): allowed when
 * `Sec-Fetch-Site` is `same-origin` or `none`; when that header is absent, `Origin` must
 * match the app's host. Bearer requests skip this.
 */

export interface HeaderReader {
  get(name: string): string | null;
}

export function requestHost(headers: HeaderReader): string | null {
  const forwarded = headers.get('x-forwarded-host');
  const host = (forwarded ? forwarded.split(',')[0] : headers.get('host')) ?? null;
  return host ? host.trim().toLowerCase() : null;
}

export function csrfOk(headers: HeaderReader): boolean {
  const site = headers.get('sec-fetch-site');
  if (site !== null) {
    const v = site.trim().toLowerCase();
    return v === 'same-origin' || v === 'none';
  }
  const origin = headers.get('origin');
  if (!origin) return false;
  const host = requestHost(headers);
  if (!host) return false;
  try {
    return new URL(origin).host.toLowerCase() === host;
  } catch {
    return false;
  }
}

/** Client IP from the platform header; `x-forwarded-for` only when the proxy is trusted. */
export function clientIp(headers: HeaderReader, trustProxy: boolean): string {
  const candidates = [headers.get('x-real-ip'), headers.get('x-vercel-forwarded-for')];
  if (trustProxy) candidates.push(headers.get('x-forwarded-for'));
  for (const c of candidates) {
    if (!c) continue;
    const first = c.split(',')[0]?.trim();
    if (first) return first.slice(0, 64);
  }
  return 'unknown';
}
