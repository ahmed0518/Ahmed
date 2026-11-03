/**
 * The daily inventory check (SPEC §14.11): deterministic rules over the slips, the jewelers
 * list, the sync stamps and today's date. Pure — the route, the Slack post and the daily
 * agent all read the same report. Every finding names the rule, so a person can look it up.
 */
import { byKind, hasWeights, latestCasting, latestCount, metalRows, missingToday, scrapSince, scrapSummary, tiles, type Tiles } from './compute';
import { SYNC_BOARDS, nameKey, type InventorySettings, type Slip, type SlipKind, type SyncBoard } from './model';

export type Severity = 'alert' | 'warn' | 'info';

export interface Finding {
  /** the rule, e.g. `metal.missing_slip` */
  id: string;
  section: SlipKind | 'sync';
  severity: Severity;
  title: string;
  detail: string;
}

export interface DailyReport {
  /** the day checked (YYYY-MM-DD, display time zone) */
  date: string;
  /** false when the day is not a work day: the missing-slip rule is skipped */
  work_day: boolean;
  tiles: Tiles;
  /** today's dust and slips, this week's net per jeweler — the numbers the report quotes */
  today: { dust_g: number; slips: number; scrap_in_g: number; scrap_out_g: number };
  findings: Finding[];
  counts: Record<Severity, number>;
  ok: boolean;
}

export interface DailyOptions {
  /** ISO weekday numbers that count as work days (1 = Monday); default Mon–Fri */
  workDays?: readonly number[];
  /** whether the monday.com sync is configured — stale/never stamps only matter then */
  syncEnabled?: boolean;
  /** ISO timestamp of "now" for the sync-age rule; default = end of `today` */
  now?: string;
}

/** Thresholds (SPEC §14.11). Grams unless stated. */
export const DAILY_THRESHOLDS = {
  /** a single slip whose loss − dust exceeds this is an alert */
  slip_net_alert: 1.5,
  /** a jeweler's 7-day net above this is a warning */
  week_net_warn: 1.0,
  /** … or above this share of the metal they handled */
  week_net_pct_warn: 2.5,
  /** a bench jeweler handing in this much dust on one day is a refinery lot or a typo */
  dust_outlier: 100,
  /** a scrapped piece or an outgoing batch this heavy is worth a look */
  scrap_big_piece: 50,
  diamond_stale_days: 14,
  diamond_very_stale_days: 30,
  casting_stale_days: 30,
  sync_stale_hours: 26,
  /** no slip at all from a listed jeweler for this many work days running */
  silent_days: 3,
} as const;

const BOARD_LABEL: Record<SyncBoard, string> = { dust: 'Gold dust (Jalgas)', diamond: 'Diamonds (Mr. Jin)', scrap: 'Scrap (Jalgas)', casting: 'Castings (Rina)' };

function dayNumber(date: string): number {
  return Math.floor(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 86_400_000);
}
function isoWeekday(date: string): number {
  const wd = new Date(dayNumber(date) * 86_400_000).getUTCDay();
  return wd === 0 ? 7 : wd;
}
function addDays(date: string, n: number): string {
  return new Date((dayNumber(date) + n) * 86_400_000).toISOString().slice(0, 10);
}
const g = (n: number) => `${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} g`;
const list = (names: readonly string[]) => names.join(', ');

/** Run every rule. `slips` is the whole store (every section). */
export function dailyCheck(slips: readonly Slip[], settings: InventorySettings, today: string, opts: DailyOptions = {}): DailyReport {
  const workDays = opts.workDays ?? [1, 2, 3, 4, 5];
  const workDay = workDays.includes(isoWeekday(today));
  const findings: Finding[] = [];
  const add = (f: Finding) => findings.push(f);
  const t = tiles(slips, today, settings.scrap_since);

  // ---------- gold dust ----------
  const metal = byKind(slips, 'metal');
  const todaysMetal = metal.filter((s) => s.date === today);
  if (workDay && settings.jewelers.length) {
    const m = missingToday(metal, settings.jewelers, today);
    if (m.missing.length) add({ id: 'metal.missing_slip', section: 'metal', severity: 'alert', title: `No slip today from ${list(m.missing)}`, detail: m.in.length ? `In from ${list(m.in)}.` : 'No gold-dust slip has come in today at all.' });
    // silent for several work days running (today included)
    const silent: string[] = [];
    for (const j of settings.jewelers) {
      let d = today;
      let run = 0;
      while (run < DAILY_THRESHOLDS.silent_days) {
        if (workDays.includes(isoWeekday(d))) {
          if (metal.some((s) => s.date === d && nameKey(s.who) === nameKey(j))) break;
          run++;
        }
        d = addDays(d, -1);
        if (dayNumber(today) - dayNumber(d) > 14) break;
      }
      if (run >= DAILY_THRESHOLDS.silent_days) silent.push(j);
    }
    if (silent.length) add({ id: 'metal.silent_jeweler', section: 'metal', severity: 'alert', title: `${list(silent)}: no slip for ${DAILY_THRESHOLDS.silent_days} work days`, detail: 'Nothing handed in or logged on the dust board. Ask before the week closes.' });
  }
  for (const s of todaysMetal) {
    if (hasWeights(s) && s.dust !== null) {
      const before = s.lines.reduce((a, l) => a + (l.before ?? 0), 0);
      const after = s.lines.reduce((a, l) => a + (l.after ?? 0), 0);
      const net = before - after - s.dust;
      if (net > DAILY_THRESHOLDS.slip_net_alert) add({ id: 'metal.slip_net', section: 'metal', severity: 'alert', title: `${s.who}: ${g(net)} did not come back today`, detail: `Before ${g(before)}, after ${g(after)}, dust ${g(s.dust)} (loss ${g(before - after)}).` });
    }
    if (s.dust !== null && s.dust >= DAILY_THRESHOLDS.dust_outlier && !/refinery/i.test(s.note)) add({ id: 'metal.dust_outlier', section: 'metal', severity: 'warn', title: `${s.who}: ${g(s.dust)} of dust on one day`, detail: 'A refinery lot logged as bench dust, or a typo. Check the slip.' });
  }
  const weekStart = addDays(today, -6);
  const week = metal.filter((s) => s.date >= weekStart && s.date <= today);
  for (const r of metalRows(week)) {
    if (!r.paired) continue;
    const net = r.pairedLoss - r.pairedDust;
    const pct = r.before > 0 ? (net / r.before) * 100 : 0;
    if (net > DAILY_THRESHOLDS.week_net_warn || pct > DAILY_THRESHOLDS.week_net_pct_warn) add({ id: 'metal.week_net', section: 'metal', severity: 'warn', title: `${r.who}: ${g(net)} net loss over 7 days (${pct.toFixed(1)}%)`, detail: `${r.paired} slip${r.paired === 1 ? '' : 's'} with both weights and dust: loss ${g(r.pairedLoss)}, dust ${g(r.pairedDust)}.` });
  }
  const refinery = week.filter((s) => /refinery/i.test(s.note) && s.dust !== null);
  if (refinery.length) add({ id: 'metal.refinery_lot', section: 'metal', severity: 'info', title: `Refinery lot${refinery.length === 1 ? '' : 's'} this week: ${g(refinery.reduce((a, s) => a + (s.dust ?? 0), 0))}`, detail: refinery.map((s) => `${s.who} ${s.date} ${g(s.dust ?? 0)}`).join(' · ') });

  // ---------- diamonds ----------
  const count = latestCount(byKind(slips, 'diamond'));
  if (!count) add({ id: 'diamond.no_count', section: 'diamond', severity: 'warn', title: 'No diamond count on file', detail: 'Mr. Jin’s board has not been pulled, or it is empty.' });
  else {
    const age = dayNumber(today) - dayNumber(count.date);
    if (age >= DAILY_THRESHOLDS.diamond_very_stale_days) add({ id: 'diamond.stale_count', section: 'diamond', severity: 'alert', title: `Diamond count is ${age} days old`, detail: `Last counted ${count.date}. Ask Mr. Jin for a fresh count.` });
    else if (age >= DAILY_THRESHOLDS.diamond_stale_days) add({ id: 'diamond.stale_count', section: 'diamond', severity: 'warn', title: `Diamond count is ${age} days old`, detail: `Last counted ${count.date}.` });
    if (count.unpriced) add({ id: 'diamond.unpriced', section: 'diamond', severity: 'info', title: `${count.unpriced} diamond size${count.unpriced === 1 ? '' : 's'} without a price`, detail: 'The value total leaves them out.' });
    const older = count.groups.filter((q) => q.date !== count.date);
    if (older.length) add({ id: 'diamond.mixed_dates', section: 'diamond', severity: 'info', title: `${list(older.map((q) => q.quality))} counted earlier than the rest`, detail: older.map((q) => `${q.quality} ${q.date}`).join(' · ') });
  }

  // ---------- scrap ----------
  const ledger = scrapSince(byKind(slips, 'scrap'), settings.scrap_since);
  const summary = scrapSummary(ledger);
  for (const row of summary.rows) {
    if (row.in - row.out < -0.005) add({ id: 'scrap.negative_on_hand', section: 'scrap', severity: 'alert', title: `${row.karat}: more scrap went out than came in (${g(row.in - row.out)})`, detail: `In ${g(row.in)}, out ${g(row.out)} since ${settings.scrap_since}. A batch was logged without its pieces, or a piece is missing from the board.` });
  }
  const todaysScrap = ledger.filter((s) => s.date === today);
  const inToday = todaysScrap.filter((s) => s.dir === 'in').reduce((a, s) => a + s.lines.reduce((b, l) => b + (l.grams ?? 0), 0), 0);
  const outToday = todaysScrap.filter((s) => s.dir === 'out').reduce((a, s) => a + s.lines.reduce((b, l) => b + (l.grams ?? 0), 0), 0);
  for (const s of todaysScrap) {
    if (s.dir === 'out') add({ id: 'scrap.outgoing', section: 'scrap', severity: 'info', title: `${g(s.lines.reduce((a, l) => a + (l.grams ?? 0), 0))} of scrap given to ${s.to || 'someone'}`, detail: s.lines.map((l) => `${l.what} ${l.karat} ${g(l.grams ?? 0)}`).join(' · ') });
    for (const l of s.lines) {
      if ((l.grams ?? 0) >= DAILY_THRESHOLDS.scrap_big_piece) add({ id: 'scrap.big_piece', section: 'scrap', severity: 'info', title: `${l.what}: ${g(l.grams ?? 0)} ${s.dir === 'in' ? 'scrapped' : 'given out'}`, detail: `${l.karat || 'karat not set'}${l.value !== null ? `, $${l.value.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : ''}` });
      if (l.value === null) add({ id: 'scrap.missing_value', section: 'scrap', severity: 'warn', title: `${l.what}: no $ on the scrap row`, detail: `${g(l.grams ?? 0)} ${l.karat || ''} ${s.dir === 'in' ? 'scrapped' : `given to ${s.to}`} today without a value.` });
      if (!l.karat) add({ id: 'scrap.missing_karat', section: 'scrap', severity: 'warn', title: `${l.what}: no karat on the scrap row`, detail: 'It cannot be counted toward the right karat on hand.' });
    }
  }

  // ---------- castings ----------
  const casting = latestCasting(byKind(slips, 'casting'));
  if (casting) {
    const age = dayNumber(today) - dayNumber(casting.date);
    if (age >= DAILY_THRESHOLDS.casting_stale_days) add({ id: 'casting.stale_count', section: 'casting', severity: 'warn', title: `Casting count is ${age} days old`, detail: `Last counted ${casting.date}.` });
    const unpriced = casting.groups.flatMap((q) => q.rows).filter((r) => r.value === null).length;
    if (unpriced) add({ id: 'casting.unpriced', section: 'casting', severity: 'info', title: `${unpriced} casting item${unpriced === 1 ? '' : 's'} without weight or $/g`, detail: 'Their value is left out of the total.' });
  } else add({ id: 'casting.no_count', section: 'casting', severity: 'info', title: 'No casting count on file', detail: 'Rina’s board has not been pulled.' });

  // ---------- sync ----------
  if (opts.syncEnabled) {
    const now = opts.now ? new Date(opts.now).getTime() : Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)), 23, 59, 59);
    for (const board of SYNC_BOARDS) {
      const stamp = settings.last_sync[board];
      if (!stamp) add({ id: 'sync.never', section: 'sync', severity: 'warn', title: `${BOARD_LABEL[board]}: never synced`, detail: 'The hourly pull has not run yet, or the board is not shared with the token.' });
      else if (!stamp.ok) add({ id: 'sync.failed', section: 'sync', severity: 'alert', title: `${BOARD_LABEL[board]}: last sync failed`, detail: `${stamp.at}${stamp.error ? ` — ${stamp.error}` : ''}` });
      else if (now - new Date(stamp.at).getTime() > DAILY_THRESHOLDS.sync_stale_hours * 3_600_000) add({ id: 'sync.stale', section: 'sync', severity: 'warn', title: `${BOARD_LABEL[board]}: not synced since ${stamp.at}`, detail: 'The hourly cron did not run. Check the Vercel cron / the Docker cron job.' });
    }
  }

  const order: Record<Severity, number> = { alert: 0, warn: 1, info: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  const counts: Record<Severity, number> = { alert: 0, warn: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;
  return {
    date: today,
    work_day: workDay,
    tiles: t,
    today: { dust_g: todaysMetal.reduce((a, s) => a + (s.dust ?? 0), 0), slips: todaysMetal.length, scrap_in_g: inToday, scrap_out_g: outToday },
    findings,
    counts,
    ok: counts.alert === 0,
  };
}

const ICON: Record<Severity, string> = { alert: ':red_circle:', warn: ':large_orange_circle:', info: ':white_circle:' };

/** Board text (names, notes, item numbers) is data: the three characters Slack would read as markup are escaped. */
export function escapeMrkdwn(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** The report as Slack mrkdwn (one message, under the 40,000-character limit by construction). */
export function formatDailyReportSlack(report: DailyReport, opts: { link?: string; title?: string } = {}): { text: string; blocks: unknown[] } {
  const title = opts.title ?? `Inventory check · ${report.date}`;
  const t = report.tiles;
  const headline = [
    `*Today:* ${g(report.today.dust_g)} dust on ${report.today.slips} slip${report.today.slips === 1 ? '' : 's'}`,
    `scrap in ${g(report.today.scrap_in_g)} / out ${g(report.today.scrap_out_g)}`,
    `*On hand:* scrap ${g(t.scrap.onhand)}`,
    t.diamond ? `diamonds ${t.diamond.ct.toFixed(2)} ct (${t.diamond.date})` : 'no diamond count',
    t.casting ? `castings ${t.casting.pcs} pcs (${t.casting.date})` : 'no casting count',
  ].join(' · ');
  const lines = report.findings.length ? report.findings.map((f) => `${ICON[f.severity]} *${escapeMrkdwn(f.title)}* — ${escapeMrkdwn(f.detail)}`) : [':white_check_mark: Nothing to flag today.'];
  const summary = `${report.counts.alert} alert${report.counts.alert === 1 ? '' : 's'} · ${report.counts.warn} warning${report.counts.warn === 1 ? '' : 's'} · ${report.counts.info} note${report.counts.info === 1 ? '' : 's'}${report.work_day ? '' : ' · not a work day'}`;
  const text = [`*${title}* — ${summary}`, headline, ...lines, opts.link ?? ''].filter(Boolean).join('\n');
  const chunks: string[] = [];
  let cur = '';
  for (const l of lines) {
    if ((cur + '\n' + l).length > 2900) {
      chunks.push(cur);
      cur = l;
    } else cur = cur ? `${cur}\n${l}` : l;
  }
  if (cur) chunks.push(cur);
  const blocks: unknown[] = [
    { type: 'header', text: { type: 'plain_text', text: title.slice(0, 150) } },
    { type: 'context', elements: [{ type: 'mrkdwn', text: summary }] },
    { type: 'section', text: { type: 'mrkdwn', text: headline } },
    ...chunks.slice(0, 40).map((c) => ({ type: 'section', text: { type: 'mrkdwn', text: c } })),
    ...(opts.link ? [{ type: 'context', elements: [{ type: 'mrkdwn', text: `<${opts.link}|Open the inventory page>` }] }] : []),
  ];
  return { text, blocks };
}
