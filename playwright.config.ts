import { defineConfig, devices } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * e2e: mock Shopify server + the built app (`next build` then `next start`) + a second app
 * instance without ADMIN_PASSCODE (to prove /admin answers 404). Honors PORT (default 3000)
 * and MOCK_SHOPIFY_PORT (default 4001). Chromium only, headless; PW_CHROMIUM_PATH overrides
 * the browser binary. The app never sees a real token: SHOPIFY_API_URL points at the mock and
 * SHOPIFY_ADMIN_TOKEN is `test_e2e`.
 */

function loadEnvFile(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(file)) return out;
  for (const rawLine of readFileSync(file, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

const port = Number(process.env.PORT ?? 3000);
const mockPort = Number(process.env.MOCK_SHOPIFY_PORT ?? 4001);
const noAdminPort = Number(process.env.NO_ADMIN_PORT ?? port + 1);
const apiVersion = '2026-10';

const testEnv = loadEnvFile(path.join(__dirname, 'tests', 'e2e', '.env.test'));
const appEnv: Record<string, string> = {
  ...testEnv,
  SHOPIFY_API_URL: `http://127.0.0.1:${mockPort}/admin/api/${apiVersion}/graphql.json`,
  SHOPIFY_ADMIN_TOKEN: 'test_e2e',
  SHOPIFY_API_VERSION: apiVersion,
};

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${port}`,
    headless: true,
    trace: 'retain-on-failure',
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm run mock:shopify',
      url: `http://127.0.0.1:${mockPort}/__state`,
      env: { MOCK_SHOPIFY_PORT: String(mockPort) },
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: 'npm run build && npm run start',
      url: `http://localhost:${port}/llms.txt`,
      env: { ...appEnv, PORT: String(port) },
      reuseExistingServer: false,
      timeout: 300_000,
    },
    {
      command: `npm run start -- -p ${noAdminPort}`,
      url: `http://localhost:${noAdminPort}/llms.txt`,
      env: { ...appEnv, ADMIN_PASSCODE: '', PORT: String(noAdminPort) },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
