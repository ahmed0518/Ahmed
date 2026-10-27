/**
 * The three ports the e2e run uses, resolved in one place for playwright.config.ts and the
 * specs: the app (`PORT`, default 3000), the mock Shopify server (`MOCK_SHOPIFY_PORT`,
 * default 4001) and the passcode-less app copy (`NO_ADMIN_PORT`, default `PORT + 1`, or
 * `PORT + 2` when that would collide with the mock). Any collision is a configuration error.
 */
export const APP_PORT = Number(process.env.PORT ?? 3000);
export const MOCK_PORT = Number(process.env.MOCK_SHOPIFY_PORT ?? 4001);
export const NO_ADMIN_PORT = Number(process.env.NO_ADMIN_PORT ?? (APP_PORT + 1 === MOCK_PORT ? APP_PORT + 2 : APP_PORT + 1));

for (const [name, value] of [
  ['PORT', APP_PORT],
  ['MOCK_SHOPIFY_PORT', MOCK_PORT],
  ['NO_ADMIN_PORT', NO_ADMIN_PORT],
] as const) {
  if (!Number.isInteger(value) || value <= 0 || value > 65535) throw new Error(`${name} must be a port number, got "${String(value)}"`);
}
if (new Set([APP_PORT, MOCK_PORT, NO_ADMIN_PORT]).size !== 3) {
  throw new Error(`PORT (${APP_PORT}), MOCK_SHOPIFY_PORT (${MOCK_PORT}) and NO_ADMIN_PORT (${NO_ADMIN_PORT}) must be three different ports`);
}
