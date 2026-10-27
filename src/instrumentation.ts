/**
 * Boot hook: validate the environment once at server start (SPEC §9) and log the effective
 * Shopify host so a mock/real mix-up is visible immediately. Any violation throws with a
 * clear message. Skipped during `next build`, which needs no secrets.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  const { getEnv } = await import('@/lib/env');
  const { log } = await import('@/lib/log');
  const env = getEnv();
  for (const w of env.warnings) log.warn(w);
  log.info('trax production status booting', {
    graphql_host: new URL(env.graphqlUrl).host,
    mock_shopify: env.SHOPIFY_API_URL !== null,
    api_version: env.SHOPIFY_API_VERSION,
    admin_enabled: env.ADMIN_PASSCODE !== null,
    read_token: env.READ_TOKEN !== null,
    api_token_labels: env.API_TOKENS.map((t) => t.label),
    display_tz: env.DISPLAY_TZ,
  });
}
