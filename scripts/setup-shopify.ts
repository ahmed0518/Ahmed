/**
 * One-time, idempotent Shopify setup (SPEC §10): checks scopes, creates the missing
 * metafield definitions in the `trax_production` namespace and writes the default settings
 * and an empty staff roster when they do not exist yet. Never touches `job`, `due_date`,
 * `design_image`. Run: `npm run setup:shopify` (reads .env.local / .env when present).
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type {
  AccessScopesData,
  CreateMetafieldDefinitionData,
  MetafieldDefinitionsData,
  MetafieldsSetData,
  MetafieldsSetInput,
  ShopSettingsData,
} from '../src/lib/shopify/types';

function loadDotEnv(file: string): void {
  if (!existsSync(file)) return;
  for (const rawLine of readFileSync(file, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv(path.join(process.cwd(), '.env.local'));
loadDotEnv(path.join(process.cwd(), '.env'));

type Def = { ownerType: 'ORDER' | 'SHOP'; key: string; name: string; type: string; description: string; validations?: { name: string; value: string }[] };

const DEFINITIONS: Def[] = [
  { ownerType: 'ORDER', key: 'item_status', name: 'Production item status', type: 'json', description: 'Per-line-item production status and history (Trax Production Status app). Authoritative.' },
  { ownerType: 'ORDER', key: 'last_updated_at', name: 'Production status last updated at', type: 'date_time', description: 'Derived from item_status.' },
  { ownerType: 'ORDER', key: 'last_updated_by', name: 'Production status last updated by', type: 'single_line_text_field', description: 'Derived from item_status.', validations: [{ name: 'max', value: '200' }] },
  { ownerType: 'ORDER', key: 'summary', name: 'Production status summary', type: 'single_line_text_field', description: 'Derived from item_status, e.g. "0/2 done · CAD ×1 — Ahmed, Oct 27".', validations: [{ name: 'max', value: '200' }] },
  { ownerType: 'SHOP', key: 'settings', name: 'Production status settings', type: 'json', description: 'Status list, staleness and watch query for the Trax Production Status app.' },
  { ownerType: 'SHOP', key: 'staff', name: 'Production status staff', type: 'json', description: 'Staff roster (names and PIN hashes) for the Trax Production Status app. Never edit by hand.' },
];

const ALLOWED_SCOPES = new Set(['read_orders', 'write_orders', 'read_all_orders']);
const REQUIRED_SCOPES = ['write_orders', 'read_all_orders'];

async function main(): Promise<void> {
  const { getEnv } = await import('../src/lib/env');
  const { shopifyGraphQL } = await import('../src/lib/shopify/client');
  const q = await import('../src/lib/shopify/queries');
  const { defaultSettings, defaultStaff } = await import('../src/lib/settings/model');

  const env = getEnv();
  console.log(`Shopify host: ${new URL(env.graphqlUrl).host} (API ${env.SHOPIFY_API_VERSION})`);

  // 1. scopes
  const scopes = await shopifyGraphQL<AccessScopesData>(q.AccessScopes);
  const handles = scopes.currentAppInstallation.accessScopes.map((s) => s.handle);
  console.log(`Scopes: ${handles.join(', ') || '(none)'}`);
  const missing = REQUIRED_SCOPES.filter((s) => !handles.includes(s));
  if (missing.length > 0) {
    throw new Error(`Missing required scopes: ${missing.join(', ')}. Add them to the app version in the Dev Dashboard and reinstall.`);
  }
  for (const h of handles) if (!ALLOWED_SCOPES.has(h)) console.warn(`WARNING: scope "${h}" is not needed by this app — consider removing it.`);

  // 2. existing definitions
  for (const ownerType of ['ORDER', 'SHOP'] as const) {
    const existing = await shopifyGraphQL<MetafieldDefinitionsData>(q.MetafieldDefinitions, { ownerType });
    const byKey = new Map(existing.metafieldDefinitions.nodes.map((n) => [n.key, n]));
    for (const def of DEFINITIONS.filter((d) => d.ownerType === ownerType)) {
      const found = byKey.get(def.key);
      if (found) {
        if (found.type.name !== def.type) {
          throw new Error(`Definition ${ownerType} trax_production.${def.key} exists with type ${found.type.name}, expected ${def.type}. Aborting — fix it in Shopify first.`);
        }
        const storefront = found.access?.storefront ?? 'NONE';
        if (storefront !== 'NONE') {
          throw new Error(`Definition ${ownerType} trax_production.${def.key} has storefront access ${storefront}; it must be NONE. Fix it in Shopify → Settings → Custom data.`);
        }
        console.log(`ok      ${ownerType} trax_production.${def.key} (${def.type})`);
        continue;
      }
      // 3. create
      const input = {
        name: def.name,
        namespace: 'trax_production',
        key: def.key,
        type: def.type,
        ownerType,
        description: def.description,
        pin: false,
        access: { storefront: 'NONE' },
        ...(def.validations ? { validations: def.validations } : {}),
      };
      const res = await shopifyGraphQL<CreateMetafieldDefinitionData>(q.CreateMetafieldDefinition, { d: input });
      const errors = res.metafieldDefinitionCreate.userErrors;
      if (errors.length > 0) {
        if (errors.some((e) => e.code === 'TAKEN')) {
          console.log(`ok      ${ownerType} trax_production.${def.key} (already taken)`);
          continue;
        }
        throw new Error(`Could not create ${ownerType} trax_production.${def.key}: ${JSON.stringify(errors)}`);
      }
      const created = res.metafieldDefinitionCreate.createdDefinition;
      console.log(`created ${ownerType} trax_production.${def.key} (${created?.type.name}, admin ${created?.access?.admin ?? '?'}, storefront ${created?.access?.storefront ?? '?'})`);
    }
  }

  // 4. default settings + empty staff when missing
  const shop = await shopifyGraphQL<ShopSettingsData>(q.ShopSettings);
  const writes: MetafieldsSetInput[] = [];
  if (!shop.shop.settings?.value) {
    writes.push({ ownerId: shop.shop.id, namespace: 'trax_production', key: 'settings', type: 'json', value: JSON.stringify(defaultSettings()), compareDigest: null });
  }
  if (!shop.shop.staff?.value) {
    writes.push({ ownerId: shop.shop.id, namespace: 'trax_production', key: 'staff', type: 'json', value: JSON.stringify(defaultStaff()), compareDigest: null });
  }
  if (writes.length > 0) {
    const res = await shopifyGraphQL<MetafieldsSetData>(q.SetShopSettings, { metafields: writes });
    if (res.metafieldsSet.userErrors.length > 0) throw new Error(`Could not write shop metafields: ${JSON.stringify(res.metafieldsSet.userErrors)}`);
    for (const w of writes) console.log(`wrote   SHOP trax_production.${w.key} (defaults)`);
  } else {
    console.log('ok      SHOP settings and staff already exist — left untouched');
  }
  console.log('Done. Next: open /admin, add staff names and PINs.');
}

main().catch((e: unknown) => {
  console.error(`setup failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
