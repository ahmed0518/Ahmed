/**
 * Mock Shopify Admin GraphQL server for tests (SPEC §3, §11).
 *
 * - POST /admin/api/<version>/graphql.json — dispatches on the GraphQL operation name and
 *   keeps shop + orders (metafields, tags) in memory. compareDigest changes on every write
 *   and is enforced on metafieldsSet (STALE_OBJECT). Evaluates `tag:`, `status:`, `name:`
 *   and `fulfillment_status:` terms of `$q`; other terms match everything.
 * - POST /admin/oauth/access_token — client-credentials grant.
 * - POST /__reset, POST /__seed (orders, settings, staff, scopes, failures), GET /__state
 *   (metafields, tags, call log).
 * - Honors MOCK_SHOPIFY_PORT (default 4001). Run with `npm run mock:shopify`.
 *
 * Dependency-free on purpose: it must run with tsx before the app is built.
 */
import { createHash, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

const PORT = Number(process.env.MOCK_SHOPIFY_PORT ?? 4001);
const HOST = process.env.MOCK_SHOPIFY_HOST ?? '127.0.0.1';
const PAGE_SIZE = 50;

interface MockMetafield {
  type: string;
  value: string;
  compareDigest: string;
  updatedAt: string;
}

interface MockLineItem {
  id: string;
  title: string;
  variantTitle: string | null;
  sku: string | null;
  quantity: number;
  currentQuantity: number;
  requiresShipping: boolean;
  isGiftCard: boolean;
  customAttributes: { key: string; value: string | null }[];
}

interface MockOrder {
  id: string;
  legacyResourceId: string;
  name: string;
  number: number;
  createdAt: string;
  closed: boolean;
  cancelledAt: string | null;
  displayFulfillmentStatus: string;
  tags: string[];
  lineItems: MockLineItem[];
  metafields: Map<string, MockMetafield>;
}

interface Definition {
  key: string;
  name: string;
  type: string;
  ownerType: string;
  storefront: string;
}

type FailureKind = 'STALE_OBJECT' | 'THROTTLED' | 'HTTP_500' | 'HTTP_401';

interface Failure {
  operation: string;
  kind: FailureKind;
}

interface CallLog {
  operation: string;
  variables: unknown;
  at: string;
  outcome: string;
}

interface State {
  shop: { id: string; name: string; myshopifyDomain: string; metafields: Map<string, MockMetafield> };
  orders: Map<number, MockOrder>;
  scopes: string[];
  calls: CallLog[];
  failures: Failure[];
  definitions: Definition[];
  writes: number;
  tokensMinted: number;
}

function freshState(): State {
  return {
    shop: { id: 'gid://shopify/Shop/64243138648', name: 'Mock TraxNYC', myshopifyDomain: 'mock.myshopify.com', metafields: new Map() },
    orders: new Map(),
    scopes: ['read_orders', 'write_orders', 'read_all_orders'],
    calls: [],
    failures: [],
    definitions: [],
    writes: 0,
    tokensMinted: 0,
  };
}

let state = freshState();

// ---------------------------------------------------------------------------------------
// helpers

function digestFor(key: string, value: string): string {
  state.writes += 1;
  return createHash('sha256').update(`${state.writes}:${key}:${value}`).digest('hex').slice(0, 32);
}

function typeForKey(key: string): string {
  if (key.endsWith('.item_status') || key.endsWith('.settings') || key.endsWith('.staff') || key.endsWith('.job')) return 'json';
  if (key.endsWith('.last_updated_at')) return 'date_time';
  if (key.endsWith('.due_date')) return 'date';
  if (key.endsWith('.custody')) return 'multi_line_text_field';
  return 'single_line_text_field';
}

function setMetafield(map: Map<string, MockMetafield>, key: string, value: string, type?: string): MockMetafield {
  const mf: MockMetafield = { type: type ?? typeForKey(key), value, compareDigest: digestFor(key, value), updatedAt: new Date().toISOString() };
  map.set(key, mf);
  return mf;
}

function mfOut(map: Map<string, MockMetafield>, key: string): { value: string; compareDigest: string } | null {
  const mf = map.get(key);
  return mf ? { value: mf.value, compareDigest: mf.compareDigest } : null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function orderNode(o: MockOrder, withLineItems: boolean): Record<string, unknown> {
  const node: Record<string, unknown> = {
    id: o.id,
    legacyResourceId: o.legacyResourceId,
    name: o.name,
    number: o.number,
    createdAt: o.createdAt,
    closed: o.closed,
    cancelledAt: o.cancelledAt,
    displayFulfillmentStatus: o.displayFulfillmentStatus,
    tags: [...o.tags],
    currentSubtotalLineItemsQuantity: o.lineItems.reduce((n, li) => n + li.currentQuantity, 0),
    itemStatus: mfOut(o.metafields, 'trax_production.item_status'),
    productionDate: mfOut(o.metafields, 'custom.production_date'),
    custody: mfOut(o.metafields, 'custom.custody'),
    giveTo: mfOut(o.metafields, 'custom.give_to'),
    dueDate: mfOut(o.metafields, 'trax_production.due_date'),
  };
  if (withLineItems) {
    node.lastUpdatedAt = mfOut(o.metafields, 'trax_production.last_updated_at');
    node.lastUpdatedBy = mfOut(o.metafields, 'trax_production.last_updated_by');
    node.summary = mfOut(o.metafields, 'trax_production.summary');
    node.lineItems = {
      nodes: o.lineItems.map((li) => ({
        id: `gid://shopify/LineItem/${li.id}`,
        title: li.title,
        variantTitle: li.variantTitle,
        sku: li.sku,
        quantity: li.quantity,
        currentQuantity: li.currentQuantity,
        requiresShipping: li.requiresShipping,
        isGiftCard: li.isGiftCard,
        customAttributes: li.customAttributes,
      })),
    };
  }
  return node;
}

/** Shopify search syntax subset: whitespace-separated terms, quotes, parentheses ignored, AND/OR dropped. */
function tokenize(q: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: string | null = null;
  for (const ch of q) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '(' || ch === ')') continue;
    if (/\s/.test(ch)) {
      if (cur) out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out.filter((t) => t.toUpperCase() !== 'AND' && t.toUpperCase() !== 'OR');
}

function orderMatches(o: MockOrder, q: string): boolean {
  for (const raw of tokenize(q)) {
    const negate = raw.startsWith('-');
    const term = negate ? raw.slice(1) : raw;
    const idx = term.indexOf(':');
    if (idx <= 0) continue;
    const key = term.slice(0, idx).toLowerCase();
    const value = term.slice(idx + 1).toLowerCase();
    let r = true;
    switch (key) {
      case 'tag':
        r = o.tags.some((t) => t.toLowerCase() === value);
        break;
      case 'status':
        if (value === 'open') r = !o.closed && !o.cancelledAt;
        else if (value === 'closed') r = o.closed;
        else if (value === 'cancelled') r = Boolean(o.cancelledAt);
        else r = true;
        break;
      case 'name':
        r = value.replace(/^#/, '') === String(o.number);
        break;
      case 'fulfillment_status':
        if (value === 'unshipped' || value === 'unfulfilled') r = o.displayFulfillmentStatus !== 'FULFILLED';
        else if (value === 'shipped' || value === 'fulfilled') r = o.displayFulfillmentStatus === 'FULFILLED';
        else if (value === 'partial') r = o.displayFulfillmentStatus === 'PARTIALLY_FULFILLED';
        else r = true;
        break;
      default:
        r = true;
    }
    if (negate ? r : !r) return false;
  }
  return true;
}

function resolveOwner(ownerId: string): Map<string, MockMetafield> | null {
  if (ownerId === state.shop.id) return state.shop.metafields;
  for (const o of state.orders.values()) if (o.id === ownerId) return o.metafields;
  return null;
}

function findOrderByGid(id: string): MockOrder | null {
  for (const o of state.orders.values()) if (o.id === id) return o;
  return null;
}

function costExtensions(requested: number) {
  return {
    cost: {
      requestedQueryCost: requested,
      actualQueryCost: requested,
      throttleStatus: { maximumAvailable: 2000, currentlyAvailable: 2000 - requested, restoreRate: 100 },
    },
  };
}

// ---------------------------------------------------------------------------------------
// seeding

function seedOrder(raw: Record<string, unknown>): MockOrder {
  const number = Number(raw.number);
  if (!Number.isInteger(number) || number <= 0) throw new Error('order needs a numeric "number"');
  const legacy = String(raw.legacy_id ?? 189300000000 + number);
  const lineItems: MockLineItem[] = [];
  const rawItems = Array.isArray(raw.line_items) ? raw.line_items : [];
  rawItems.forEach((li, i) => {
    if (!isRecord(li)) return;
    const quantity = typeof li.quantity === 'number' ? li.quantity : 1;
    lineItems.push({
      id: String(li.id ?? `${number}${String(i + 1).padStart(3, '0')}`),
      title: String(li.title ?? `Item ${i + 1}`),
      variantTitle: typeof li.variant_title === 'string' ? li.variant_title : null,
      sku: typeof li.sku === 'string' ? li.sku : null,
      quantity,
      currentQuantity: typeof li.current_quantity === 'number' ? li.current_quantity : quantity,
      requiresShipping: li.requires_shipping !== false,
      isGiftCard: li.is_gift_card === true,
      customAttributes: Array.isArray(li.custom_attributes)
        ? li.custom_attributes.filter(isRecord).map((a) => ({ key: String(a.key ?? ''), value: typeof a.value === 'string' ? a.value : null }))
        : [],
    });
  });
  const order: MockOrder = {
    id: `gid://shopify/Order/${legacy}`,
    legacyResourceId: legacy,
    name: typeof raw.name === 'string' ? raw.name : `#${number}`,
    number,
    createdAt: typeof raw.created_at === 'string' ? raw.created_at : new Date().toISOString(),
    closed: raw.closed === true,
    cancelledAt: typeof raw.cancelled_at === 'string' ? raw.cancelled_at : null,
    displayFulfillmentStatus: typeof raw.fulfillment_status === 'string' ? raw.fulfillment_status : 'UNFULFILLED',
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    lineItems,
    metafields: new Map(),
  };
  if (isRecord(raw.metafields)) {
    for (const [key, value] of Object.entries(raw.metafields)) {
      if (value === null || value === undefined) continue;
      const text = typeof value === 'string' ? value : JSON.stringify(value);
      setMetafield(order.metafields, key, text);
    }
  }
  return order;
}

function applySeed(body: Record<string, unknown>): { orders: number } {
  if (body.reset === true) state = freshState();
  if (Array.isArray(body.orders)) {
    for (const raw of body.orders) {
      if (!isRecord(raw)) continue;
      const o = seedOrder(raw);
      state.orders.set(o.number, o);
    }
  }
  if ('settings' in body) {
    if (body.settings === null) state.shop.metafields.delete('trax_production.settings');
    else setMetafield(state.shop.metafields, 'trax_production.settings', typeof body.settings === 'string' ? body.settings : JSON.stringify(body.settings));
  }
  if ('staff' in body) {
    if (body.staff === null) state.shop.metafields.delete('trax_production.staff');
    else setMetafield(state.shop.metafields, 'trax_production.staff', typeof body.staff === 'string' ? body.staff : JSON.stringify(body.staff));
  }
  if (Array.isArray(body.scopes)) state.scopes = body.scopes.map(String);
  if (Array.isArray(body.failures)) {
    for (const f of body.failures) {
      if (isRecord(f) && typeof f.operation === 'string' && typeof f.kind === 'string') {
        state.failures.push({ operation: f.operation, kind: f.kind as FailureKind });
      }
    }
  }
  if (body.clear_calls === true) state.calls = [];
  return { orders: state.orders.size };
}

function stateOut() {
  const mfMap = (m: Map<string, MockMetafield>) => Object.fromEntries([...m.entries()].map(([k, v]) => [k, { type: v.type, value: v.value, compareDigest: v.compareDigest, updatedAt: v.updatedAt }]));
  return {
    shop: { id: state.shop.id, name: state.shop.name, metafields: mfMap(state.shop.metafields) },
    orders: [...state.orders.values()].map((o) => ({
      number: o.number,
      name: o.name,
      id: o.id,
      tags: [...o.tags],
      closed: o.closed,
      cancelledAt: o.cancelledAt,
      displayFulfillmentStatus: o.displayFulfillmentStatus,
      metafields: mfMap(o.metafields),
    })),
    scopes: [...state.scopes],
    failures: [...state.failures],
    definitions: [...state.definitions],
    calls: [...state.calls],
    tokens_minted: state.tokensMinted,
  };
}

// ---------------------------------------------------------------------------------------
// GraphQL operations

type GraphQLBody = { query?: string; variables?: Record<string, unknown>; operationName?: string };
type Result = { status?: number; body: unknown };

function userError(field: (string | number)[], message: string, code: string) {
  return { field: field.map(String), message, code };
}

function metafieldsSet(variables: Record<string, unknown>): Result {
  const inputs = Array.isArray(variables.metafields) ? variables.metafields : [];
  const errors: ReturnType<typeof userError>[] = [];
  const plan: { map: Map<string, MockMetafield>; key: string; type: string; value: string }[] = [];
  inputs.forEach((input, i) => {
    if (!isRecord(input)) {
      errors.push(userError(['metafields', i], 'Invalid input', 'INVALID_VALUE'));
      return;
    }
    const map = resolveOwner(String(input.ownerId ?? ''));
    if (!map) {
      errors.push(userError(['metafields', i, 'ownerId'], 'Owner not found', 'INVALID_VALUE'));
      return;
    }
    const key = `${String(input.namespace)}.${String(input.key)}`;
    const existing = map.get(key);
    const type = typeof input.type === 'string' ? input.type : (existing?.type ?? typeForKey(key));
    const value = String(input.value ?? '');
    if ('compareDigest' in input) {
      const current = existing?.compareDigest ?? null;
      const given = input.compareDigest === undefined ? null : input.compareDigest;
      if (given !== null && typeof given !== 'string') {
        errors.push(userError(['metafields', i, 'compareDigest'], 'Invalid compareDigest', 'INVALID_COMPARE_DIGEST'));
        return;
      }
      if (given !== current) {
        errors.push(userError(['metafields', i, 'compareDigest'], 'The metafield has been modified since it was loaded.', 'STALE_OBJECT'));
        return;
      }
    }
    if (type === 'json') {
      try {
        JSON.parse(value);
      } catch {
        errors.push(userError(['metafields', i, 'value'], 'Value is not valid JSON', 'INVALID_VALUE'));
        return;
      }
    }
    if (type === 'date_time' && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(value)) {
      errors.push(userError(['metafields', i, 'value'], 'Value is not a date_time', 'INVALID_VALUE'));
      return;
    }
    if (type === 'single_line_text_field' && /[\r\n]/.test(value)) {
      errors.push(userError(['metafields', i, 'value'], 'Single line text cannot contain line breaks', 'INVALID_VALUE'));
      return;
    }
    plan.push({ map, key, type, value });
  });
  if (errors.length > 0) return { body: { data: { metafieldsSet: { metafields: null, userErrors: errors } } } };
  const written = plan.map((p) => {
    const mf = setMetafield(p.map, p.key, p.value, p.type);
    return { key: p.key.slice(p.key.indexOf('.') + 1), compareDigest: mf.compareDigest, updatedAt: mf.updatedAt };
  });
  return { body: { data: { metafieldsSet: { metafields: written, userErrors: [] } }, extensions: costExtensions(10) } };
}

function tagMutation(op: 'tagsAdd' | 'tagsRemove', variables: Record<string, unknown>): Result {
  const order = findOrderByGid(String(variables.id ?? ''));
  if (!order) return { body: { data: { [op]: { node: null, userErrors: [{ field: ['id'], message: 'Order not found' }] } } } };
  const tags = Array.isArray(variables.tags) ? variables.tags.map(String) : [];
  if (op === 'tagsAdd') {
    for (const t of tags) if (!order.tags.includes(t)) order.tags.push(t);
  } else {
    order.tags = order.tags.filter((t) => !tags.includes(t));
  }
  return { body: { data: { [op]: { node: { id: order.id }, userErrors: [] } }, extensions: costExtensions(10) } };
}

function dispatch(op: string, variables: Record<string, unknown>): Result {
  switch (op) {
    case 'OrderByName': {
      const q = String(variables.q ?? '');
      const nodes = [...state.orders.values()].filter((o) => orderMatches(o, q)).slice(0, 3);
      return { body: { data: { orders: { nodes: nodes.map((o) => orderNode(o, true)) } }, extensions: costExtensions(330) } };
    }
    case 'OrdersByQuery': {
      const q = String(variables.q ?? '');
      const all = [...state.orders.values()].filter((o) => orderMatches(o, q)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      let start = 0;
      if (typeof variables.cursor === 'string' && variables.cursor) {
        start = Number(Buffer.from(variables.cursor, 'base64').toString('utf8')) || 0;
      }
      const page = all.slice(start, start + PAGE_SIZE);
      const end = start + page.length;
      return {
        body: {
          data: {
            orders: {
              nodes: page.map((o) => orderNode(o, false)),
              pageInfo: { hasNextPage: end < all.length, endCursor: page.length ? Buffer.from(String(end)).toString('base64') : null },
            },
          },
          extensions: costExtensions(302),
        },
      };
    }
    case 'SetOrderStatus':
    case 'SetShopSettings':
      return metafieldsSet(variables);
    case 'AddTags':
      return tagMutation('tagsAdd', variables);
    case 'RemoveTags':
      return tagMutation('tagsRemove', variables);
    case 'ShopSettings':
      return {
        body: {
          data: {
            shop: {
              id: state.shop.id,
              name: state.shop.name,
              settings: mfOut(state.shop.metafields, 'trax_production.settings'),
              staff: mfOut(state.shop.metafields, 'trax_production.staff'),
            },
          },
          extensions: costExtensions(3),
        },
      };
    case 'AccessScopes':
      return { body: { data: { currentAppInstallation: { accessScopes: state.scopes.map((handle) => ({ handle })) } } } };
    case 'ShopInfo':
      return { body: { data: { shop: { id: state.shop.id, name: state.shop.name, myshopifyDomain: state.shop.myshopifyDomain } } } };
    case 'MetafieldDefinitions': {
      const ownerType = String(variables.ownerType ?? 'ORDER');
      const nodes = state.definitions
        .filter((d) => d.ownerType === ownerType)
        .map((d) => ({ key: d.key, name: d.name, type: { name: d.type }, access: { storefront: d.storefront } }));
      return { body: { data: { metafieldDefinitions: { nodes } } } };
    }
    case 'CreateMetafieldDefinition': {
      const d = isRecord(variables.d) ? variables.d : {};
      const key = String(d.key ?? '');
      const ownerType = String(d.ownerType ?? 'ORDER');
      const access = isRecord(d.access) ? d.access : {};
      if ('admin' in access) {
        return {
          body: {
            data: {
              metafieldDefinitionCreate: {
                createdDefinition: null,
                userErrors: [userError(['definition', 'access', 'admin'], 'Admin access is not allowed for this namespace', 'ADMIN_ACCESS_INPUT_NOT_ALLOWED')],
              },
            },
          },
        };
      }
      if (state.definitions.some((x) => x.key === key && x.ownerType === ownerType)) {
        return {
          body: { data: { metafieldDefinitionCreate: { createdDefinition: null, userErrors: [userError(['definition', 'key'], 'Key is in use', 'TAKEN')] } } },
        };
      }
      const def: Definition = {
        key,
        name: String(d.name ?? key),
        type: String(d.type ?? 'single_line_text_field'),
        ownerType,
        storefront: typeof access.storefront === 'string' ? access.storefront : 'NONE',
      };
      state.definitions.push(def);
      return {
        body: {
          data: {
            metafieldDefinitionCreate: {
              createdDefinition: { id: `gid://shopify/MetafieldDefinition/${state.definitions.length}`, key, type: { name: def.type }, access: { admin: 'PUBLIC_READ_WRITE', storefront: def.storefront } },
              userErrors: [],
            },
          },
        },
      };
    }
    default:
      return { body: { errors: [{ message: `Mock Shopify: unknown operation "${op}"` }] } };
  }
}

function failureResult(kind: FailureKind, op: string): Result {
  switch (kind) {
    case 'STALE_OBJECT':
      return {
        body: {
          data: {
            metafieldsSet: {
              metafields: null,
              userErrors: [userError(['metafields', 0, 'compareDigest'], 'The metafield has been modified since it was loaded.', 'STALE_OBJECT')],
            },
          },
        },
      };
    case 'THROTTLED':
      return {
        body: {
          errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED', documentation: 'https://shopify.dev/api/usage/rate-limits' } }],
          extensions: { cost: { requestedQueryCost: 302, actualQueryCost: null, throttleStatus: { maximumAvailable: 2000, currentlyAvailable: 10, restoreRate: 1000 } } },
        },
      };
    case 'HTTP_500':
      return { status: 500, body: { errors: `Internal Server Error (${op})` } };
    case 'HTTP_401':
      return { status: 401, body: { errors: '[API] Invalid API key or access token (unrecognized login or wrong password)' } };
  }
}

// ---------------------------------------------------------------------------------------
// HTTP

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(text);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${HOST}:${PORT}`);
  const method = req.method ?? 'GET';
  try {
    if (method === 'GET' && url.pathname === '/__state') return send(res, 200, stateOut());
    if (method === 'POST' && url.pathname === '/__reset') {
      state = freshState();
      return send(res, 200, { ok: true });
    }
    if (method === 'POST' && url.pathname === '/__seed') {
      const body = JSON.parse((await readBody(req)) || '{}') as unknown;
      if (!isRecord(body)) return send(res, 400, { error: 'body must be an object' });
      return send(res, 200, { ok: true, ...applySeed(body) });
    }
    if (method === 'POST' && url.pathname === '/admin/oauth/access_token') {
      const params = new URLSearchParams(await readBody(req));
      state.calls.push({ operation: 'AccessToken', variables: { grant_type: params.get('grant_type'), client_id: params.get('client_id') }, at: new Date().toISOString(), outcome: 'ok' });
      if (params.get('grant_type') !== 'client_credentials' || !params.get('client_id') || !params.get('client_secret')) {
        return send(res, 400, { error: 'invalid_request', error_description: 'grant_type=client_credentials with client_id and client_secret required' });
      }
      state.tokensMinted += 1;
      return send(res, 200, { access_token: `test_minted_${state.tokensMinted}`, scope: state.scopes.join(','), expires_in: 86399 });
    }
    const gql = /^\/admin\/api\/([^/]+)\/graphql\.json$/.exec(url.pathname);
    if (method === 'POST' && gql) {
      const version = gql[1] ?? 'unknown';
      const headers = { 'X-Shopify-API-Version': version, 'X-Request-ID': randomUUID() };
      if (!req.headers['x-shopify-access-token']) {
        return send(res, 401, { errors: '[API] Invalid API key or access token (unrecognized login or wrong password)' }, headers);
      }
      const body = JSON.parse((await readBody(req)) || '{}') as GraphQLBody;
      const query = body.query ?? '';
      const op = body.operationName ?? /^\s*(?:query|mutation)\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(query)?.[1] ?? 'anonymous';
      const variables = body.variables ?? {};
      const failIdx = state.failures.findIndex((f) => f.operation === op || f.operation === '*');
      let result: Result;
      let outcome = 'ok';
      if (failIdx >= 0) {
        const [f] = state.failures.splice(failIdx, 1);
        result = failureResult(f!.kind, op);
        outcome = f!.kind;
      } else {
        result = dispatch(op, variables);
        const data = isRecord(result.body) && isRecord(result.body.data) ? result.body.data : null;
        const set = data && isRecord(data.metafieldsSet) ? data.metafieldsSet : null;
        if (set && Array.isArray(set.userErrors) && set.userErrors.length > 0) outcome = String((set.userErrors[0] as { code?: string }).code ?? 'USER_ERROR');
        if (isRecord(result.body) && Array.isArray(result.body.errors)) outcome = 'GRAPHQL_ERROR';
      }
      state.calls.push({ operation: op, variables, at: new Date().toISOString(), outcome });
      process.stdout.write(`[mock-shopify] ${op} → ${outcome}\n`);
      return send(res, result.status ?? 200, result.body, headers);
    }
    if (method === 'GET' && url.pathname === '/') return send(res, 200, 'mock shopify admin graphql — POST /admin/api/<version>/graphql.json');
    return send(res, 404, { error: 'not found' });
  } catch (e) {
    process.stderr.write(`[mock-shopify] error: ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
    return send(res, 500, { error: 'mock error', detail: e instanceof Error ? e.message : String(e) });
  }
});

server.listen(PORT, HOST, () => {
  process.stdout.write(`[mock-shopify] listening on http://${HOST}:${PORT}\n`);
});
