/**
 * Boot validation of the environment (SPEC §9). `getEnv()` validates once, caches the
 * result and throws with a clear message listing every violation. No default exists for
 * any secret. `instrumentation.ts` calls it at server start so misconfiguration fails fast.
 */

export interface ApiToken {
  label: string;
  token: string;
}

/**
 * Which request headers may name the client (SPEC §5). `none` (unset): no header is
 * trusted, every anonymous caller shares one rate-limit bucket. `vercel`: the platform
 * headers `x-real-ip` / `x-vercel-forwarded-for`. `forwarded` (`TRUST_PROXY=1`): the address
 * appended by the one reverse proxy in front of the app (last entry of `x-forwarded-for`).
 * The same setting decides whether `x-forwarded-host` may stand in for `host`.
 */
export type ProxyTrust = 'none' | 'vercel' | 'forwarded';

export interface Env {
  SHOPIFY_STORE_DOMAIN: string;
  SHOPIFY_ADMIN_TOKEN: string | null;
  SHOPIFY_CLIENT_ID: string | null;
  SHOPIFY_CLIENT_SECRET: string | null;
  SHOPIFY_API_VERSION: string;
  SHOPIFY_API_URL: string | null;
  SHOPIFY_ADMIN_HANDLE: string;
  SESSION_SECRET: string;
  PIN_PEPPER: string;
  /** null = /admin disabled (404) */
  ADMIN_PASSCODE: string | null;
  API_TOKENS: ApiToken[];
  READ_TOKEN: string | null;
  TRUST_PROXY: ProxyTrust;
  DISPLAY_TZ: string;
  isProduction: boolean;
  /** Full GraphQL endpoint URL. */
  graphqlUrl: string;
  /** Client-credentials token endpoint (derived from the GraphQL host in test mode). */
  tokenUrl: string;
  /** Set when ADMIN_PASSCODE is present but shorter than 16 characters. */
  warnings: string[];
}

export class EnvError extends Error {
  constructor(problems: string[]) {
    super(`Invalid environment:\n - ${problems.join('\n - ')}`);
    this.name = 'EnvError';
  }
}

const HEX64 = /^[0-9a-fA-F]{64,}$/;
const API_VERSION_RE = /^(\d{4}-(01|04|07|10)|unstable)$/;
const LABEL_RE = /^[A-Za-z0-9_-]{1,40}$/;

export type EnvSource = Record<string, string | undefined>;

function read(name: string, source: EnvSource): string | null {
  const raw = source[name];
  if (raw === undefined) return null;
  const v = raw.trim();
  return v === '' ? null : v;
}

export function parseApiTokens(raw: string | null): { tokens: ApiToken[]; problems: string[] } {
  const tokens: ApiToken[] = [];
  const problems: string[] = [];
  if (!raw) return { tokens, problems };
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const pair = part.trim();
    if (!pair) continue;
    const idx = pair.indexOf(':');
    if (idx <= 0) {
      problems.push(`API_TOKENS entry "${pair.slice(0, 12)}…" is not label:token`);
      continue;
    }
    const label = pair.slice(0, idx).trim();
    const token = pair.slice(idx + 1).trim();
    if (!LABEL_RE.test(label)) problems.push(`API_TOKENS label "${label}" must match ${LABEL_RE}`);
    if (token.length < 32) problems.push(`API_TOKENS token for "${label}" must be at least 32 characters`);
    if (seen.has(label)) problems.push(`API_TOKENS label "${label}" is duplicated`);
    seen.add(label);
    tokens.push({ label, token });
  }
  return { tokens, problems };
}

export function parseProxyTrust(raw: string | null): ProxyTrust | null {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === '' || v === '0' || v === 'false' || v === 'none') return 'none';
  if (v === '1' || v === 'true' || v === 'forwarded') return 'forwarded';
  if (v === 'vercel') return 'vercel';
  return null;
}

function validTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function buildEnv(source: EnvSource = process.env): Env {
  const problems: string[] = [];
  const warnings: string[] = [];

  const sessionSecret = read('SESSION_SECRET', source);
  const pinPepper = read('PIN_PEPPER', source);
  if (!sessionSecret || !HEX64.test(sessionSecret)) {
    problems.push('SESSION_SECRET must be at least 64 hex characters (openssl rand -hex 32)');
  }
  if (!pinPepper || !HEX64.test(pinPepper)) {
    problems.push('PIN_PEPPER must be at least 64 hex characters (openssl rand -hex 32)');
  }
  if (sessionSecret && pinPepper && sessionSecret.toLowerCase() === pinPepper.toLowerCase()) {
    problems.push('PIN_PEPPER must differ from SESSION_SECRET');
  }

  const adminPasscodeRaw = read('ADMIN_PASSCODE', source);
  let adminPasscode: string | null = null;
  if (adminPasscodeRaw && adminPasscodeRaw.length >= 16) {
    adminPasscode = adminPasscodeRaw;
  } else if (adminPasscodeRaw) {
    warnings.push('ADMIN_PASSCODE is shorter than 16 characters — /admin is disabled (404)');
  } else {
    warnings.push('ADMIN_PASSCODE is not set — /admin is disabled (404)');
  }

  const { tokens: apiTokens, problems: tokenProblems } = parseApiTokens(read('API_TOKENS', source));
  problems.push(...tokenProblems);

  const readToken = read('READ_TOKEN', source);
  if (readToken && readToken.length < 32) problems.push('READ_TOKEN must be at least 32 characters');

  const storeDomain = read('SHOPIFY_STORE_DOMAIN', source);
  const adminToken = read('SHOPIFY_ADMIN_TOKEN', source);
  const clientId = read('SHOPIFY_CLIENT_ID', source);
  const clientSecret = read('SHOPIFY_CLIENT_SECRET', source);
  const apiVersion = read('SHOPIFY_API_VERSION', source) ?? '2026-10';
  const apiUrl = read('SHOPIFY_API_URL', source);
  if (!API_VERSION_RE.test(apiVersion)) problems.push('SHOPIFY_API_VERSION must look like 2026-10');

  let graphqlUrl = '';
  let tokenUrl = '';
  if (apiUrl) {
    let parsed: URL | null = null;
    try {
      parsed = new URL(apiUrl);
    } catch {
      problems.push('SHOPIFY_API_URL must be a full URL to …/graphql.json');
    }
    if (parsed && !parsed.pathname.endsWith('/graphql.json')) {
      problems.push('SHOPIFY_API_URL must end with /graphql.json');
    }
    if (!adminToken || !adminToken.startsWith('test_')) {
      problems.push('SHOPIFY_API_URL is set (mock mode) but SHOPIFY_ADMIN_TOKEN does not start with "test_" — a real token is never sent to a mock host');
    }
    if (parsed) {
      graphqlUrl = parsed.toString();
      tokenUrl = `${parsed.origin}/admin/oauth/access_token`;
    }
  } else {
    if (!storeDomain || !/^[a-z0-9-]+\.myshopify\.com$/i.test(storeDomain)) {
      problems.push('SHOPIFY_STORE_DOMAIN must be the myshopify domain, e.g. 05nbj6-yr.myshopify.com');
    }
    if (!adminToken && !(clientId && clientSecret)) {
      problems.push('Set SHOPIFY_ADMIN_TOKEN or both SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET');
    }
    if (storeDomain) {
      graphqlUrl = `https://${storeDomain}/admin/api/${apiVersion}/graphql.json`;
      tokenUrl = `https://${storeDomain}/admin/oauth/access_token`;
    }
  }

  const adminHandle =
    read('SHOPIFY_ADMIN_HANDLE', source) ?? (storeDomain ? storeDomain.replace(/\.myshopify\.com$/i, '') : 'store');

  const displayTz = read('DISPLAY_TZ', source) ?? 'America/New_York';
  if (!validTimeZone(displayTz)) problems.push(`DISPLAY_TZ "${displayTz}" is not a valid IANA time zone`);

  const trustProxy = parseProxyTrust(read('TRUST_PROXY', source));
  if (trustProxy === null) problems.push('TRUST_PROXY must be empty, "vercel" (Vercel platform headers) or "1" (one reverse proxy setting x-forwarded-for)');

  if (problems.length > 0) throw new EnvError(problems);

  return {
    SHOPIFY_STORE_DOMAIN: storeDomain ?? '',
    SHOPIFY_ADMIN_TOKEN: adminToken,
    SHOPIFY_CLIENT_ID: clientId,
    SHOPIFY_CLIENT_SECRET: clientSecret,
    SHOPIFY_API_VERSION: apiVersion,
    SHOPIFY_API_URL: apiUrl,
    SHOPIFY_ADMIN_HANDLE: adminHandle,
    SESSION_SECRET: sessionSecret as string,
    PIN_PEPPER: pinPepper as string,
    ADMIN_PASSCODE: adminPasscode,
    API_TOKENS: apiTokens,
    READ_TOKEN: readToken,
    TRUST_PROXY: trustProxy ?? 'none',
    DISPLAY_TZ: displayTz,
    isProduction: source.NODE_ENV === 'production',
    graphqlUrl,
    tokenUrl,
    warnings,
  };
}

let cached: Env | null = null;

export function getEnv(): Env {
  if (!cached) cached = buildEnv(process.env);
  return cached;
}

/** Unit tests only. */
export function resetEnvCache(): void {
  cached = null;
}
