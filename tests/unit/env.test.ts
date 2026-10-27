import { describe, expect, it } from 'vitest';
import { EnvError, buildEnv } from '@/lib/env';

const good = {
  SHOPIFY_STORE_DOMAIN: '05nbj6-yr.myshopify.com',
  SHOPIFY_CLIENT_ID: 'id',
  SHOPIFY_CLIENT_SECRET: 'secret',
  SESSION_SECRET: 'a'.repeat(64),
  PIN_PEPPER: 'b'.repeat(64),
  ADMIN_PASSCODE: 'x'.repeat(16),
  API_TOKENS: 'claude:' + 'c'.repeat(32),
};

describe('environment validation', () => {
  it('accepts a complete configuration and derives urls', () => {
    const env = buildEnv(good);
    expect(env.graphqlUrl).toBe('https://05nbj6-yr.myshopify.com/admin/api/2026-10/graphql.json');
    expect(env.tokenUrl).toBe('https://05nbj6-yr.myshopify.com/admin/oauth/access_token');
    expect(env.SHOPIFY_ADMIN_HANDLE).toBe('05nbj6-yr');
    expect(env.API_TOKENS).toEqual([{ label: 'claude', token: 'c'.repeat(32) }]);
    expect(env.ADMIN_PASSCODE).toBe('x'.repeat(16));
    expect(env.warnings).toEqual([]);
  });

  it('throws with every problem listed', () => {
    const run = () => buildEnv({ ...good, SESSION_SECRET: 'short', PIN_PEPPER: 'short', READ_TOKEN: 'tiny' });
    expect(run).toThrow(EnvError);
    expect(run).toThrow(/SESSION_SECRET/);
    expect(run).toThrow(/READ_TOKEN/);
    expect(() => buildEnv({ ...good, PIN_PEPPER: good.SESSION_SECRET })).toThrow(/differ/);
    expect(() => buildEnv({ ...good, SHOPIFY_CLIENT_ID: '', SHOPIFY_CLIENT_SECRET: '' })).toThrow(/SHOPIFY_ADMIN_TOKEN/);
    expect(() => buildEnv({ ...good, DISPLAY_TZ: 'Mars/Olympus' })).toThrow(/DISPLAY_TZ/);
  });

  it('disables /admin for a short or missing passcode with a warning', () => {
    expect(buildEnv({ ...good, ADMIN_PASSCODE: 'short' }).ADMIN_PASSCODE).toBeNull();
    expect(buildEnv({ ...good, ADMIN_PASSCODE: '' }).warnings[0]).toMatch(/ADMIN_PASSCODE/);
  });

  it('TRUST_PROXY names the one header source that may be believed', () => {
    expect(buildEnv(good).TRUST_PROXY).toBe('none');
    expect(buildEnv({ ...good, TRUST_PROXY: '' }).TRUST_PROXY).toBe('none');
    expect(buildEnv({ ...good, TRUST_PROXY: '1' }).TRUST_PROXY).toBe('forwarded');
    expect(buildEnv({ ...good, TRUST_PROXY: 'vercel' }).TRUST_PROXY).toBe('vercel');
    expect(() => buildEnv({ ...good, TRUST_PROXY: 'yes' })).toThrow(/TRUST_PROXY/);
  });

  it('refuses the published e2e values in a real production boot, accepts them in mock mode and in development', () => {
    const testSecret = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const prod = { ...good, NODE_ENV: 'production' };
    expect(() => buildEnv({ ...prod, SESSION_SECRET: testSecret })).toThrow(/SESSION_SECRET is the published test value from tests\/e2e\/\.env\.test/);
    expect(() => buildEnv({ ...prod, PIN_PEPPER: 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210' })).toThrow(/PIN_PEPPER/);
    expect(() => buildEnv({ ...prod, ADMIN_PASSCODE: 'e2e-admin-passcode-not-secret' })).toThrow(/ADMIN_PASSCODE/);
    expect(() => buildEnv({ ...prod, READ_TOKEN: 'e2e_claude_token_0123456789abcdef0123456789' })).toThrow(/READ_TOKEN/);
    expect(() => buildEnv({ ...prod, API_TOKENS: 'maks-ai:e2e_maks_token_0123456789abcdef0123456789abc' })).toThrow(/API_TOKENS token for "maks-ai"/);
    expect(buildEnv(prod).isProduction).toBe(true);
    // the e2e run itself: production build, mock host — allowed
    const mock = { ...prod, SESSION_SECRET: testSecret, SHOPIFY_API_URL: 'http://127.0.0.1:4001/admin/api/2026-10/graphql.json', SHOPIFY_ADMIN_TOKEN: 'test_e2e' };
    expect(buildEnv(mock).SESSION_SECRET).toBe(testSecret);
    expect(buildEnv({ ...good, NODE_ENV: 'development', SESSION_SECRET: testSecret }).SESSION_SECRET).toBe(testSecret);
  });

  it('mock mode requires a test_ token and wins over the store domain', () => {
    const mock = { ...good, SHOPIFY_API_URL: 'http://127.0.0.1:4001/admin/api/2026-10/graphql.json', SHOPIFY_ADMIN_TOKEN: 'test_e2e' };
    const env = buildEnv(mock);
    expect(env.graphqlUrl).toBe('http://127.0.0.1:4001/admin/api/2026-10/graphql.json');
    expect(env.tokenUrl).toBe('http://127.0.0.1:4001/admin/oauth/access_token');
    expect(() => buildEnv({ ...mock, SHOPIFY_ADMIN_TOKEN: 'shpat_real' })).toThrow(/test_/);
    expect(() => buildEnv({ ...mock, SHOPIFY_API_URL: 'http://127.0.0.1:4001/' })).toThrow(/graphql\.json/);
  });
});
