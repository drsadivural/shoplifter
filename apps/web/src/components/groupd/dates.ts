// Calendar-date helpers for <input type="date"> values interpreted in the STORE timezone
// (never the browser timezone). API timestamps stay RFC 3339 UTC.
import { formatDate } from '../../lib/format';

function wallClock(at: Date, timeZone: string): number {
  const p: Record<string, string> = {};
  for (const x of new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at))
    p[x.type] = x.value;
  const hour = p.hour === '24' ? 0 : Number(p.hour);
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), hour, Number(p.minute), Number(p.second));
}

/** "2026-12-01" in `timeZone` -> UTC ISO string at the start (00:00:00) or end (23:59:59) of that day. */
export function zonedDateToIso(date: string, timeZone: string, edge: 'start' | 'end' = 'end'): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const [h, mi, s] = edge === 'end' ? [23, 59, 59] : [0, 0, 0];
  const guess = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), h, mi, s);
  const offset = wallClock(new Date(guess), timeZone) - guess;
  const utc = guess - offset;
  // Re-check once across DST transitions.
  const offset2 = wallClock(new Date(utc), timeZone) - utc;
  return new Date(guess - offset2).toISOString().replace('.000Z', 'Z');
}

/** Today's calendar date in the store timezone. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return formatDate(now, timeZone);
}

/** Calendar arithmetic on "YYYY-MM-DD". */
export function addDays(date: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return d.toISOString().slice(0, 10);
}

/** ISO timestamp -> "YYYY-MM-DD" in the store timezone ('' when absent). */
export function isoToZonedDate(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return '';
  const s = formatDate(iso, timeZone);
  return s === '—' ? '' : s;
}

/** "2026-12-01T14:30" (store wall clock, <input type="datetime-local">) -> UTC ISO string. */
export function zonedDateTimeToIso(value: string, timeZone: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const guess = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), 0);
  const offset = wallClock(new Date(guess), timeZone) - guess;
  const offset2 = wallClock(new Date(guess - offset), timeZone) - (guess - offset);
  return new Date(guess - offset2).toISOString().replace('.000Z', 'Z');
}

/** ISO timestamp -> "YYYY-MM-DDTHH:mm" store wall clock for <input type="datetime-local"> ('' when absent). */
export function isoToZonedDateTime(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return '';
  const t = wallClock(new Date(iso), timeZone);
  return Number.isNaN(t) ? '' : new Date(t).toISOString().slice(0, 16);
}

/** Current store wall clock as "YYYY-MM-DDTHH:mm" (upper bound for "last seen"). */
export function nowIn(timeZone: string, now: Date = new Date()): string {
  return new Date(wallClock(now, timeZone)).toISOString().slice(0, 16);
}
