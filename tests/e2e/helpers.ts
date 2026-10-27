import { createHash } from 'node:crypto';
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { PIN_PEPPER, STAFF, buildSeed } from './fixtures';
import { APP_PORT, MOCK_PORT, NO_ADMIN_PORT } from './ports';

export { APP_PORT };
export const MOCK_URL = `http://127.0.0.1:${MOCK_PORT}`;
export const NO_ADMIN_URL = `http://localhost:${NO_ADMIN_PORT}`;

export function pinHash(id: string, pin: string): string {
  return createHash('sha256').update(`${PIN_PEPPER}:${id}:${pin}`).digest('hex');
}

export async function seedAll(request: APIRequestContext): Promise<void> {
  const res = await request.post(`${MOCK_URL}/__seed`, { data: buildSeed(new Date(), pinHash) });
  expect(res.ok()).toBeTruthy();
}

export async function seedExtra(request: APIRequestContext, body: Record<string, unknown>): Promise<void> {
  const res = await request.post(`${MOCK_URL}/__seed`, { data: body });
  expect(res.ok()).toBeTruthy();
}

export interface MockState {
  shop: { id: string; metafields: Record<string, { type: string; value: string; compareDigest: string }> };
  orders: {
    number: number;
    name: string;
    id: string;
    tags: string[];
    metafields: Record<string, { type: string; value: string; compareDigest: string }>;
  }[];
  calls: { operation: string; variables: Record<string, unknown>; at: string; outcome: string }[];
  failures: { operation: string; kind: string }[];
}

export async function mockState(request: APIRequestContext): Promise<MockState> {
  const res = await request.get(`${MOCK_URL}/__state`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as MockState;
}

export function mockOrder(state: MockState, number: number) {
  const o = state.orders.find((x) => x.number === number);
  if (!o) throw new Error(`mock has no order ${number}`);
  return o;
}

/** The staff roster as the mock stores it (hashes included — this is the store, not a response). */
export function mockStaff(state: MockState): { id: string; failed_attempts: number; locked_until: string | null }[] {
  const raw = state.shop.metafields['trax_production.staff'];
  if (!raw) throw new Error('mock has no staff metafield');
  return (JSON.parse(raw.value) as { staff: { id: string; failed_attempts: number; locked_until: string | null }[] }).staff;
}

export function mockSettings(state: MockState): { admin_failed_attempts: number; admin_locked_until: string | null } {
  const raw = state.shop.metafields['trax_production.settings'];
  if (!raw) throw new Error('mock has no settings metafield');
  return JSON.parse(raw.value) as { admin_failed_attempts: number; admin_locked_until: string | null };
}

export function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

export function originHeader(): Record<string, string> {
  return { Origin: `http://localhost:${APP_PORT}`, 'Content-Type': 'application/json' };
}

/** Log in through the API with the page's cookie jar (same-origin via the Origin header). */
export async function loginAs(page: Page, id: string = 'ahmed'): Promise<void> {
  const member = STAFF.find((s) => s.id === id);
  if (!member) throw new Error(`unknown staff ${id}`);
  const res = await page.request.post('/api/login', { data: { id, pin: member.pin }, headers: originHeader() });
  expect(res.status(), await res.text()).toBe(200);
}

/** Refresh the app's list cache (credentialed `?fresh=1`). */
export async function refreshList(request: APIRequestContext, token: string): Promise<void> {
  const res = await request.get('/api/orders?fresh=1', { headers: bearer(token) });
  expect(res.ok()).toBeTruthy();
}
