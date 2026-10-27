/**
 * Seed data for the mock Shopify server. Every spec seeds the same set so the app's caches
 * (settings 30 s, list 60 s) never disagree between files. Timestamps are relative to `now`.
 */

export const ADMIN_PASSCODE = 'e2e-admin-passcode-not-secret';
export const CLAUDE_TOKEN = 'e2e_claude_token_0123456789abcdef0123456789';
export const MAKS_TOKEN = 'e2e_maks_token_0123456789abcdef0123456789abc';
export const PIN_PEPPER = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';

export const STAFF = [
  { id: 'ahmed', name: 'Ahmed', pin: '1234' },
  { id: 'igor', name: 'Igor', pin: '2468' },
  // used only by the lockout test, which leaves the name locked
  { id: 'lena', name: 'Lena', pin: '1357' },
];

const STATUSES = [
  { id: 'cad', name: 'CAD' },
  { id: 'assembling', name: 'Assembling' },
  { id: 'mold', name: 'Mold' },
  { id: 'polishing', name: 'Polishing' },
  { id: 'polishing_erik', name: 'Polishing Erik' },
  { id: 'polishing_maria', name: 'Polishing Maria' },
  { id: 'casting', name: 'Casting' },
  { id: 'engraving', name: 'Engraving' },
  { id: 'final_polishing', name: 'Final Polishing' },
  { id: 'cleaning_casting', name: 'Cleaning Casting' },
  { id: 'resizing', name: 'Resizing' },
  { id: 'setting', name: 'Setting' },
  { id: 'setting_azavedo', name: 'Setting Azavedo' },
  { id: 'setting_igor', name: 'Setting Igor' },
  { id: 'setting_jorje', name: 'Setting Jorje' },
  { id: 'waiting_for_dia', name: 'Waiting for DIA', waiting: true },
  { id: 'sent_to_store', name: 'Sent to Store', done: true },
  { id: 'sent_to_shipping_dept', name: 'Sent to Shipping Dept', done: true },
  { id: 'waiting_for_chain', name: 'Waiting for Chain', waiting: true },
];

export const SETTINGS = {
  v: 1,
  statuses: STATUSES,
  stale_after_days: 3,
  work_days: [1, 2, 3, 4, 5],
  hide_items_matching: ['warranty', 'shipping protection'],
  watch_query: 'tag:custom-item-order status:open fulfillment_status:unshipped',
  admin_failed_attempts: 0,
  admin_locked_until: null,
};

function ts(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function daysAgo(now: Date, days: number): string {
  return ts(new Date(now.getTime() - days * 86_400_000));
}

function entry(title: string, status: string | null, at: string, by: string, extra: Partial<{ source: string; via: string; note: string }> = {}) {
  const source = extra.source ?? 'web';
  const via = extra.via ?? `web:${by}`;
  return { title, status, updated_at: at, updated_by: by, source, via, history: [{ kind: 'set', status, at, by, source, via, note: extra.note ?? '' }] };
}

export const ORDERS = {
  neverSet: 251548,
  staleInProduction: 251600,
  freshInProduction: 251601,
  removedLine: 251602,
  watchNeverSet: 251603,
  untracked: 251604,
  staleObjectRetry: 251605,
  allDone: 251606,
  stillHere: 251607,
  shipped: 251608,
  mobile: 251610,
  /** tagged trax-production by hand, no item_status at all — must stay in the chase list */
  taggedNeverSet: 251611,
  /** tagged, item_status is not even JSON — the tag must be left alone */
  malformedStatus: 251612,
  /** item_status knows a line item id that is no longer on the order */
  orphanEntry: 251613,
};

/** Needs sha256 hashes; computed by the caller with node:crypto (see seedAll). */
export function buildSeed(now: Date, pinHash: (id: string, pin: string) => string) {
  const staff = {
    v: 1,
    staff: STAFF.map((s) => ({ id: s.id, name: s.name, pin_hash: pinHash(s.id, s.pin), active: true, session_version: 1, failed_attempts: 0, locked_until: null })),
  };

  const orders = [
    {
      number: ORDERS.neverSet,
      created_at: daysAgo(now, 10),
      tags: ['custom-item-order'],
      line_items: [
        { id: '50788056399960', title: '14K Gold 20 Pt Lab Diamond Tennis Bracelet 71679', variant_title: 'Yellow Gold / 8 Inches', quantity: 1 },
        { id: '50788056432728', title: '14K Gold 20 Pt Lab Diamond Tennis Bracelet 71679', variant_title: 'Yellow Gold / 7 Inches', quantity: 1 },
        { id: '50788056465496', title: '1-Month Silver Warranty', quantity: 1, requires_shipping: false },
      ],
      metafields: { 'custom.production_date': 'Ships by Fri, Oct 30 (Akshata, Oct 22)', 'custom.custody': 'Bench 2\nIgor', 'trax_production.due_date': '2026-10-30' },
    },
    {
      number: ORDERS.staleInProduction,
      created_at: daysAgo(now, 12),
      tags: ['custom-item-order', 'trax-production'],
      line_items: [
        { id: '60000000000001', title: 'Custom Silver 2.5-Inches Pendant - LAB Diamonds', quantity: 1, custom_attributes: [{ key: 'Engraving', value: 'MOM' }, { key: '_hidden', value: 'x' }] },
        { id: '60000000000002', title: '14K Rope Chain 3mm', variant_title: '22 Inches', quantity: 2 },
      ],
      metafields: {
        'trax_production.item_status': {
          v: 1,
          visible_ids: ['60000000000001', '60000000000002'],
          items: {
            '60000000000001': entry('Custom Silver 2.5-Inches Pendant - LAB Diamonds', 'cad', daysAgo(now, 7), 'Ahmed'),
            '60000000000002': entry('14K Rope Chain 3mm', 'polishing', daysAgo(now, 6.5), 'Igor'),
          },
        },
      },
    },
    {
      number: ORDERS.freshInProduction,
      created_at: daysAgo(now, 3),
      tags: ['trax-production'],
      line_items: [{ id: '60000000000011', title: 'Iced Out Cuban Link Bracelet', quantity: 1 }],
      metafields: {
        'trax_production.item_status': {
          v: 1,
          visible_ids: ['60000000000011'],
          items: { '60000000000011': entry('Iced Out Cuban Link Bracelet', 'setting_igor', ts(new Date(now.getTime() - 3_600_000)), 'Maks', { source: 'api', via: 'token:maks-ai', note: 'rush' }) },
        },
      },
    },
    {
      number: ORDERS.removedLine,
      created_at: daysAgo(now, 4),
      tags: ['trax-production'],
      line_items: [
        { id: '60000000000021', title: 'Diamond Stud Earrings', quantity: 1 },
        { id: '60000000000022', title: 'Removed Pendant', quantity: 1, current_quantity: 0 },
      ],
      metafields: {
        'trax_production.item_status': {
          v: 1,
          visible_ids: ['60000000000021', '60000000000022'],
          items: {
            '60000000000021': entry('Diamond Stud Earrings', 'casting', daysAgo(now, 1), 'Ahmed'),
            '60000000000022': entry('Removed Pendant', 'polishing', daysAgo(now, 2), 'Ahmed'),
          },
        },
      },
    },
    {
      number: ORDERS.watchNeverSet,
      created_at: daysAgo(now, 20),
      tags: ['custom-item-order'],
      line_items: [{ id: '60000000000031', title: 'Custom Name Necklace', quantity: 1 }],
      metafields: {},
    },
    {
      number: ORDERS.untracked,
      created_at: daysAgo(now, 2),
      tags: ['wholesale'],
      line_items: [{ id: '60000000000041', title: 'Plain Band', quantity: 1 }],
      metafields: {},
    },
    {
      number: ORDERS.staleObjectRetry,
      created_at: daysAgo(now, 1),
      tags: ['custom-item-order'],
      line_items: [{ id: '60000000000051', title: 'Signet Ring', quantity: 1 }],
      metafields: {},
    },
    {
      number: ORDERS.allDone,
      created_at: daysAgo(now, 6),
      tags: ['trax-production'],
      line_items: [
        { id: '60000000000061', title: 'Tennis Necklace', quantity: 1 },
        { id: '60000000000062', title: 'Tennis Bracelet', quantity: 1 },
      ],
      metafields: {
        'trax_production.item_status': {
          v: 1,
          visible_ids: ['60000000000061', '60000000000062'],
          items: {
            '60000000000061': entry('Tennis Necklace', 'final_polishing', daysAgo(now, 1), 'Ahmed'),
            '60000000000062': entry('Tennis Bracelet', 'final_polishing', daysAgo(now, 1), 'Ahmed'),
          },
        },
      },
    },
    {
      number: ORDERS.stillHere,
      created_at: daysAgo(now, 8),
      tags: ['trax-production'],
      line_items: [{ id: '60000000000071', title: 'Cross Pendant', quantity: 1 }],
      metafields: {
        'trax_production.item_status': {
          v: 1,
          visible_ids: ['60000000000071'],
          items: { '60000000000071': entry('Cross Pendant', 'waiting_for_dia', daysAgo(now, 6), 'Igor') },
        },
      },
    },
    {
      number: ORDERS.shipped,
      created_at: daysAgo(now, 30),
      tags: ['trax-production'],
      fulfillment_status: 'FULFILLED',
      line_items: [{ id: '60000000000081', title: 'Shipped Ring', quantity: 1 }],
      metafields: {
        'trax_production.item_status': {
          v: 1,
          visible_ids: ['60000000000081'],
          items: { '60000000000081': entry('Shipped Ring', 'polishing', daysAgo(now, 25), 'Ahmed') },
        },
      },
    },
    {
      number: ORDERS.mobile,
      created_at: daysAgo(now, 5),
      tags: ['trax-production'],
      line_items: [
        { id: '60000000000091', title: 'Extremely Long Product Title That Keeps Going And Going For Testing Narrow Phone Screens 123456789', variant_title: 'Rose Gold / 18 Inches / Extra Long Variant Name', quantity: 3 },
        { id: '60000000000092', title: 'Second Item', quantity: 1 },
      ],
      metafields: {
        'trax_production.item_status': {
          v: 1,
          visible_ids: ['60000000000091', '60000000000092'],
          items: { '60000000000091': entry('Extremely Long Product Title', 'engraving', daysAgo(now, 2), 'Ahmed') },
        },
      },
    },
    {
      number: ORDERS.taggedNeverSet,
      created_at: daysAgo(now, 9),
      tags: ['trax-production'],
      line_items: [{ id: '60000000000111', title: 'Hand-tagged Bangle', quantity: 1 }],
      metafields: {},
    },
    {
      number: ORDERS.malformedStatus,
      created_at: daysAgo(now, 9),
      tags: ['trax-production'],
      line_items: [{ id: '60000000000121', title: 'Garbled Pendant', quantity: 1 }],
      metafields: { 'trax_production.item_status': '{not json' },
    },
    {
      number: ORDERS.orphanEntry,
      created_at: daysAgo(now, 3),
      tags: ['trax-production'],
      line_items: [{ id: '60000000000131', title: 'Eternity Band', quantity: 1 }],
      metafields: {
        'trax_production.item_status': {
          v: 1,
          visible_ids: ['60000000000131'],
          items: {
            '60000000000131': entry('Eternity Band', 'casting', daysAgo(now, 1), 'Ahmed'),
            '60000000000139': entry('Vanished Charm', 'mold', daysAgo(now, 2), 'Ahmed'),
          },
        },
      },
    },
  ];

  return { reset: true, settings: SETTINGS, staff, orders, scopes: ['read_orders', 'write_orders', 'read_all_orders'], clear_calls: true };
}
