import { afterEach, describe, expect, it } from 'vitest';
import { resetEnvCache } from '@/lib/env';
import { actorName, resolveViewer } from '@/lib/inventory/access';
import { defaultInventorySettings } from '@/lib/inventory/model';

const BASE = {
  SHOPIFY_STORE_DOMAIN: '05nbj6-yr.myshopify.com',
  SHOPIFY_CLIENT_ID: 'id',
  SHOPIFY_CLIENT_SECRET: 'secret',
  SESSION_SECRET: 'a'.repeat(64),
  PIN_PEPPER: 'b'.repeat(64),
  INVENTORY_DATA_DIR: '/tmp/x',
  INVENTORY_OWNERS: 'ahmed',
};

function withEnv(extra: Record<string, string> = {}) {
  for (const [k, v] of Object.entries({ ...BASE, ...extra })) process.env[k] = v;
  resetEnvCache();
}

describe('inventory access', () => {
  afterEach(() => {
    for (const k of Object.keys(BASE)) delete process.env[k];
    resetEnvCache();
  });

  it('staff see everything and may write unless narrowed; owners always see everything', () => {
    withEnv();
    const settings = { ...defaultInventorySettings(), access: { jin: { sections: ['diamond' as const], write: false }, ahmed: { sections: [], write: false } } };
    expect(resolveViewer({ kind: 'staff', id: 'igor', name: 'Igor' }, false, settings)).toMatchObject({ kind: 'staff', owner: false, sections: ['metal', 'diamond', 'scrap', 'casting'], canWrite: true });
    expect(resolveViewer({ kind: 'staff', id: 'jin', name: 'Jin' }, false, settings)).toMatchObject({ owner: false, sections: ['diamond'], canWrite: false });
    expect(resolveViewer({ kind: 'staff', id: 'ahmed', name: 'Ahmed' }, false, settings)).toMatchObject({ owner: true, sections: ['metal', 'diamond', 'scrap', 'casting'], canWrite: true });
    expect(resolveViewer({ kind: 'staff', id: 'igor', name: 'Igor' }, true, settings).owner).toBe(true);
  });

  it('tokens, the read token, the admin cookie and nobody', () => {
    withEnv();
    const s = defaultInventorySettings();
    expect(resolveViewer({ kind: 'token', label: 'claude' }, false, s)).toMatchObject({ kind: 'token', canWrite: true, owner: false, sections: ['metal', 'diamond', 'scrap', 'casting'] });
    expect(resolveViewer({ kind: 'read_token' }, false, s)).toMatchObject({ kind: 'read_token', canWrite: false });
    expect(resolveViewer(null, true, s)).toMatchObject({ kind: 'admin', owner: true, canWrite: true });
    expect(resolveViewer(null, false, s)).toMatchObject({ kind: 'anonymous', sections: [], canWrite: false });
    expect(actorName(resolveViewer({ kind: 'token', label: 'claude' }, false, s))).toBe('token:claude');
    expect(actorName(resolveViewer({ kind: 'staff', id: 'igor', name: 'Igor' }, false, s))).toBe('Igor');
  });
});
