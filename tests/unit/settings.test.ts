import { describe, expect, it } from 'vitest';
import { applySettingsForm, applyStaffAction, parseStaffAction, staffView } from '@/lib/admin/model';
import { AppError } from '@/lib/errors';
import { resolveChangeStatus } from '@/lib/orders/service';
import { defaultSettings, resolveStatus, slugify, validateSettings, validateStaff } from '@/lib/settings/model';
import type { Settings } from '@/lib/status/types';

function thrown(fn: () => unknown): AppError {
  try {
    fn();
  } catch (e) {
    if (e instanceof AppError) return e;
    throw e;
  }
  throw new Error('expected an AppError');
}

describe('settings validation', () => {
  it('accepts the defaults and rejects duplicates and bad fields', () => {
    const d = defaultSettings();
    expect(validateSettings(d)).toEqual(d);
    expect(validateSettings({ ...d, statuses: [...d.statuses, { id: 'cad', name: 'Other' }] })).toBeNull();
    expect(validateSettings({ ...d, statuses: [...d.statuses, { id: 'other', name: 'cad' }] })).toBeNull();
    expect(validateSettings({ ...d, statuses: [{ id: 'x', name: 'x'.repeat(61) }] })).toBeNull();
    expect(validateSettings({ ...d, work_days: [0] })).toBeNull();
    expect(validateSettings({ ...d, stale_after_days: 1.5 })).toBeNull();
    expect(validateSettings({ ...d, hide_items_matching: 'warranty' })).toBeNull();
    expect(validateSettings({ ...d, v: 2 })).toBeNull();
    expect(validateSettings({ ...d, admin_locked_until: 'soon' })).toBeNull();
    expect(validateSettings('nope')).toBeNull();
  });

  it('validates staff and keeps unknown fields out', () => {
    const member = { id: 'ahmed', name: 'Ahmed', pin_hash: 'a'.repeat(64), active: true, session_version: 1, failed_attempts: 0, locked_until: null, email: 'x@y' };
    const r = validateStaff({ v: 1, staff: [member] });
    expect(r?.staff[0]).toEqual({ id: 'ahmed', name: 'Ahmed', pin_hash: 'a'.repeat(64), active: true, session_version: 1, failed_attempts: 0, locked_until: null });
    expect(validateStaff({ v: 1, staff: [member, { ...member, id: 'ahmed2' }] })).toBeNull(); // duplicate name
    expect(validateStaff({ v: 1, staff: [{ ...member, pin_hash: 'short' }] })).toBeNull();
    expect(validateStaff({ v: 1, staff: [{ ...member, id: 'Ahmed' }] })).toBeNull();
  });

  it('slugs and resolves statuses by id or name', () => {
    expect(slugify('Setting Igor')).toBe('setting_igor');
    expect(slugify('  Waiting for DIA! ')).toBe('waiting_for_dia');
    const s = defaultSettings();
    expect(resolveStatus(s, 'setting_igor')?.id).toBe('setting_igor');
    expect(resolveStatus(s, ' setting igor ')?.id).toBe('setting_igor');
    expect(resolveStatus(s, 'SETTING IGOR')?.id).toBe('setting_igor');
    expect(resolveStatus(s, 'nope')).toBeNull();
  });

  it('rejects stored names with control characters: they would poison every single-line metafield write', () => {
    const d = defaultSettings();
    expect(validateSettings({ ...d, statuses: [{ id: 'bad', name: 'Bad\nName' }] })).toBeNull();
    expect(validateSettings({ ...d, statuses: [{ id: 'bad', name: 'Bad\u0000Name' }] })).toBeNull();
    expect(validateSettings({ ...d, statuses: [{ id: 'ok', name: ' Fine Name ' }] })?.statuses[0]).toEqual({ id: 'ok', name: 'Fine Name' });
    const member = { id: 'lena', name: 'Lena', pin_hash: 'a'.repeat(64), active: true, session_version: 1, failed_attempts: 0, locked_until: null };
    expect(validateStaff({ v: 1, staff: [{ ...member, name: 'New\nLine' }] })).toBeNull();
    expect(validateStaff({ v: 1, staff: [{ ...member, name: 'New\rLine' }] })).toBeNull();
    expect(validateStaff({ v: 1, staff: [member] })).not.toBeNull();
  });
});

describe('status resolution for writes (SPEC §4.3: retired = hidden from new selections)', () => {
  const s: Settings = { ...defaultSettings(), statuses: [...defaultSettings().statuses, { id: 'old_bench', name: 'Old Bench', retired: true }] };

  it('accepts live statuses by id or name and refuses unknown ones with the selectable names', () => {
    expect(resolveChangeStatus(s, 'Setting Igor', null)).toBe('setting_igor');
    expect(resolveChangeStatus(s, 'setting_igor', 'cad')).toBe('setting_igor');
    const err = thrown(() => resolveChangeStatus(s, 'teleporting', null));
    expect(err).toMatchObject({ status: 400, code: 'unknown_status' });
    expect(err.extra?.valid_statuses).toContain('Setting Igor');
    expect(err.extra?.valid_statuses).not.toContain('Old Bench');
  });

  it('refuses a retired status as a new selection (set → 400) but accepts it as a confirmation', () => {
    for (const input of ['old_bench', 'Old Bench', ' OLD BENCH ']) {
      for (const current of [null, undefined, 'cad']) {
        const err = thrown(() => resolveChangeStatus(s, input, current));
        expect(err, `${input} on ${String(current)}`).toMatchObject({ status: 400, code: 'status_retired' });
        expect(err.message).toContain('Old Bench');
        expect(err.extra?.valid_statuses).not.toContain('Old Bench');
      }
      // "Still here" on the item that holds it keeps working
      expect(resolveChangeStatus(s, input, 'old_bench')).toBe('old_bench');
    }
  });
});

describe('admin settings form', () => {
  const current = defaultSettings();
  const form = () => ({
    statuses: current.statuses.map((s) => ({ id: s.id, name: s.name, done: Boolean(s.done), waiting: Boolean(s.waiting), retired: Boolean(s.retired) })),
    stale_after_days: 4,
    work_days: [1, 2, 3, 4, 5, 6],
    hide_items_matching: ['warranty', '', ' protection '],
    watch_query: ' tag:x ',
  });

  it('renames keep the id, new statuses get a slug, order is kept', () => {
    const f = form();
    f.statuses[0]!.name = 'CAD Design';
    f.statuses.push({ id: null as unknown as string, name: 'Stone Setting Ahmed', done: false, waiting: false, retired: false });
    const next = applySettingsForm({ ...current, admin_failed_attempts: 2 }, f);
    expect(next.statuses[0]).toEqual({ id: 'cad', name: 'CAD Design' });
    expect(next.statuses.at(-1)).toEqual({ id: 'stone_setting_ahmed', name: 'Stone Setting Ahmed' });
    expect(next.stale_after_days).toBe(4);
    expect(next.work_days).toEqual([1, 2, 3, 4, 5, 6]);
    expect(next.hide_items_matching).toEqual(['warranty', 'protection']);
    expect(next.watch_query).toBe('tag:x');
    expect(next.admin_failed_attempts).toBe(2);
  });

  it('strips control characters from status names and refuses names that are nothing else', () => {
    const f = form();
    f.statuses[0]!.name = 'CAD\nDesign\t ';
    expect(applySettingsForm(current, f).statuses[0]).toEqual({ id: 'cad', name: 'CAD Design' });
    const g = form();
    g.statuses[0]!.name = '\r\n';
    expect(() => applySettingsForm(current, g)).toThrow(/1–60/);
    const h = form();
    h.statuses[0]!.name = 'x'.repeat(61);
    expect(() => applySettingsForm(current, h)).toThrow(/1–60/);
  });

  it('refuses deletions, unknown ids, duplicate names and empty work days', () => {
    const f = form();
    f.statuses.shift();
    expect(() => applySettingsForm(current, f)).toThrow(AppError);
    const g = form();
    g.statuses[0]!.id = 'ghost';
    expect(() => applySettingsForm(current, g)).toThrow(/Unknown status id/);
    const h = form();
    h.statuses[1]!.name = 'cad';
    expect(() => applySettingsForm(current, h)).toThrow(/used twice/);
    const w = form();
    w.work_days = [];
    expect(() => applySettingsForm(current, w)).toThrow(/work day/);
  });
});

describe('admin staff actions', () => {
  const hash = (id: string, pin: string) => `${id}:${pin}`.padEnd(64, '0');

  it('cleans pasted names instead of storing a line break that would break every later write', () => {
    expect(parseStaffAction({ action: 'add', name: 'New\nLine', pin: '8888' })).toEqual({ action: 'add', name: 'New Line', pin: '8888', active: true });
    expect(parseStaffAction({ action: 'rename', id: 'ahmed', name: ' Ah\u0000med\t ' })).toEqual({ action: 'rename', id: 'ahmed', name: 'Ahmed' });
    expect(() => parseStaffAction({ action: 'add', name: '\n\t', pin: '8888' })).toThrow(/1–30/);
    expect(() => parseStaffAction({ action: 'add', name: 'x'.repeat(31), pin: '8888' })).toThrow(/1–30/);
  });

  it('add, set_pin, deactivate, clear_lock and the sanitized view', () => {
    let roster = applyStaffAction({ v: 1, staff: [] }, { action: 'add', name: 'Ahmed', pin: '1234', active: true }, hash);
    expect(roster.staff[0]).toMatchObject({ id: 'ahmed', name: 'Ahmed', active: true, session_version: 1 });
    expect(roster.staff[0]!.pin_hash).toBe(hash('ahmed', '1234'));
    expect(() => applyStaffAction(roster, { action: 'add', name: 'ahmed', pin: '1234', active: true }, hash)).toThrow(/already exists/);
    roster = applyStaffAction(roster, { action: 'set_pin', id: 'ahmed', pin: '9999' }, hash);
    expect(roster.staff[0]!.session_version).toBe(2);
    expect(roster.staff[0]!.pin_hash).toBe(hash('ahmed', '9999'));
    roster = applyStaffAction(roster, { action: 'deactivate', id: 'ahmed' }, hash);
    expect(roster.staff[0]).toMatchObject({ active: false, session_version: 3 });
    roster = applyStaffAction(roster, { action: 'activate', id: 'ahmed' }, hash);
    roster.staff[0]!.locked_until = '2099-01-01T00:00:00Z';
    roster.staff[0]!.failed_attempts = 5;
    expect(staffView(roster)[0]).toEqual({ id: 'ahmed', name: 'Ahmed', active: true, pin_set: true, locked: true });
    roster = applyStaffAction(roster, { action: 'clear_lock', id: 'ahmed' }, hash);
    expect(roster.staff[0]).toMatchObject({ failed_attempts: 0, locked_until: null });
    expect(JSON.stringify(staffView(roster))).not.toContain('pin_hash');
    expect(() => applyStaffAction(roster, { action: 'rename', id: 'ghost', name: 'X' }, hash)).toThrow(AppError);
  });
});
