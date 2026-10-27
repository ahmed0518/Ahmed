import { AppError, ShopifyRequestError, conflict } from '@/lib/errors';
import { log } from '@/lib/log';
import { findUserErrorCode, shopifyGraphQL } from '@/lib/shopify/client';
import { SetShopSettings, ShopSettings } from '@/lib/shopify/queries';
import type { MetafieldsSetData, MetafieldsSetInput, ShopSettingsData } from '@/lib/shopify/types';
import { NAMESPACE, type Settings, type StaffRoster } from '@/lib/status/types';
import { defaultSettings, defaultStaff, validateSettings, validateStaff } from './model';

/**
 * The two shop metafields `trax_production.settings` and `trax_production.staff` (SPEC §4.3):
 * read together, cached 30 s, validated on every read (invalid → defaults, logged), written
 * separately with `compareDigest` (SPEC §4.5). Read-modify-write cycles are serialized per
 * key inside this instance (so concurrent requests never clobber each other's increment)
 * and CAS-protected against other instances.
 */

export interface ShopData {
  shopId: string;
  shopName: string;
  settings: Settings;
  settingsDigest: string | null;
  settingsStored: boolean;
  staff: StaffRoster;
  staffDigest: string | null;
  staffStored: boolean;
  fetchedAt: number;
}

const CACHE_TTL_MS = 30_000;
let cache: ShopData | null = null;

function parseJson(raw: string | null | undefined): unknown {
  if (raw === null || raw === undefined || raw === '') return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export async function loadShopData(opts: { fresh?: boolean } = {}): Promise<ShopData> {
  if (!opts.fresh && cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache;
  const data = await shopifyGraphQL<ShopSettingsData>(ShopSettings);
  const shop = data.shop;

  let settings: Settings;
  const settingsStored = Boolean(shop.settings?.value);
  const rawSettings = parseJson(shop.settings?.value);
  if (rawSettings === undefined) {
    settings = defaultSettings();
  } else {
    const valid = validateSettings(rawSettings);
    if (valid) settings = valid;
    else {
      log.error('trax_production.settings is invalid — using defaults', {});
      settings = defaultSettings();
    }
  }

  let staff: StaffRoster;
  const staffStored = Boolean(shop.staff?.value);
  const rawStaff = parseJson(shop.staff?.value);
  if (rawStaff === undefined) {
    staff = defaultStaff();
  } else {
    const valid = validateStaff(rawStaff);
    if (valid) staff = valid;
    else {
      log.error('trax_production.staff is invalid — using an empty roster', {});
      staff = defaultStaff();
    }
  }

  cache = {
    shopId: shop.id,
    shopName: shop.name,
    settings,
    settingsDigest: shop.settings?.compareDigest ?? null,
    settingsStored,
    staff,
    staffDigest: shop.staff?.compareDigest ?? null,
    staffStored,
    fetchedAt: Date.now(),
  };
  return cache;
}

export async function getSettings(opts: { fresh?: boolean } = {}): Promise<Settings> {
  return (await loadShopData(opts)).settings;
}

export async function getStaff(opts: { fresh?: boolean } = {}): Promise<StaffRoster> {
  return (await loadShopData(opts)).staff;
}

export function invalidateShopCache(): void {
  cache = null;
}

type Key = 'settings' | 'staff';

async function writeShopMetafield(key: Key, shopId: string, value: string, digest: string | null): Promise<{ stale: boolean; digest: string | null }> {
  const entry: MetafieldsSetInput = { ownerId: shopId, namespace: NAMESPACE, key, type: 'json', value, compareDigest: digest };
  const data = await shopifyGraphQL<MetafieldsSetData>(SetShopSettings, { metafields: [entry] });
  const errors = data.metafieldsSet?.userErrors ?? [];
  if (errors.length > 0) {
    const code = findUserErrorCode(errors, ['STALE_OBJECT', 'INVALID_COMPARE_DIGEST']);
    if (code === 'STALE_OBJECT') return { stale: true, digest: null };
    if (code === 'INVALID_COMPARE_DIGEST') {
      throw new AppError(500, 'internal_error', 'Internal error', { detail: `INVALID_COMPARE_DIGEST writing ${key}` });
    }
    throw new ShopifyRequestError(JSON.stringify(errors), { operation: 'SetShopSettings' });
  }
  const written = data.metafieldsSet?.metafields?.find((m) => m.key === key);
  return { stale: false, digest: written?.compareDigest ?? null };
}

const CAS_ATTEMPTS = 4;

const queues: Record<Key, Promise<unknown>> = { settings: Promise.resolve(), staff: Promise.resolve() };

/** Run `fn` after every earlier read-modify-write of the same key on this instance. */
function serialized<T>(key: Key, fn: () => Promise<T>): Promise<T> {
  const run = queues[key].then(fn, fn);
  queues[key] = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Read-modify-write with CAS; the mutator receives a fresh copy on every attempt and may
 * return `null` to leave the metafield untouched. A mutator that throws aborts the update
 * without writing (used by the login lockout to refuse a locked name).
 */
export function updateSettings(mutate: (current: Settings) => Settings | null): Promise<Settings> {
  return serialized('settings', async () => {
    for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
      const data = await loadShopData({ fresh: true });
      const next = mutate(structuredClone(data.settings));
      if (next === null) return data.settings;
      const valid = validateSettings(next);
      if (!valid) throw new AppError(400, 'invalid_settings', 'Settings are invalid');
      const res = await writeShopMetafield('settings', data.shopId, JSON.stringify(valid), data.settingsDigest);
      if (res.stale) {
        log.warn('settings write hit STALE_OBJECT, retrying', { attempt });
        continue;
      }
      cache = { ...data, settings: valid, settingsDigest: res.digest, settingsStored: true, fetchedAt: Date.now() };
      return valid;
    }
    throw conflict();
  });
}

export function updateStaff(mutate: (current: StaffRoster) => StaffRoster | null): Promise<StaffRoster> {
  return serialized('staff', async () => {
    for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
      const data = await loadShopData({ fresh: true });
      const next = mutate(structuredClone(data.staff));
      if (next === null) return data.staff;
      const valid = validateStaff(next);
      if (!valid) throw new AppError(400, 'invalid_staff', 'Staff roster is invalid');
      const res = await writeShopMetafield('staff', data.shopId, JSON.stringify(valid), data.staffDigest);
      if (res.stale) {
        log.warn('staff write hit STALE_OBJECT, retrying', { attempt });
        continue;
      }
      cache = { ...data, staff: valid, staffDigest: res.digest, staffStored: true, fetchedAt: Date.now() };
      return valid;
    }
    throw conflict();
  });
}
