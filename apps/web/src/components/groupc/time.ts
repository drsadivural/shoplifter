// Store-timezone helpers for date inputs. The API takes UTC RFC 3339 timestamps; people enter
// dates/times as wall-clock time in the STORE timezone (never the browser timezone).

function offsetMinutes(at: Date, timeZone: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(at)) p[part.type] = part.value;
  const hour = p.hour === '24' ? '00' : p.hour;
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(hour), Number(p.minute), Number(p.second));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

/**
 * Wall-clock "YYYY-MM-DDTHH:mm" (or "YYYY-MM-DD", treated as 00:00) in `timeZone` -> UTC ISO string.
 * Returns null for unparseable input.
 */
export function zonedToUtcIso(local: string, timeZone: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(local.trim());
  if (!m) return null;
  const [, y, mo, d, h = '00', mi = '00'] = m;
  const naive = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi));
  if (Number.isNaN(naive)) return null;
  // Two passes handle DST transitions (offset at the guessed instant may differ).
  let guess = naive - offsetMinutes(new Date(naive), timeZone) * 60000;
  guess = naive - offsetMinutes(new Date(guess), timeZone) * 60000;
  return new Date(guess).toISOString().replace('.000Z', 'Z');
}

/** UTC ISO -> "YYYY-MM-DDTHH:mm" wall-clock in `timeZone` (for datetime-local inputs). */
export function utcToZonedInput(iso: string | Date, timeZone: string): string {
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const shifted = new Date(d.getTime() + offsetMinutes(d, timeZone) * 60000);
  return shifted.toISOString().slice(0, 16);
}

/** UTC ISO -> "YYYY-MM-DD" calendar date in `timeZone` (for date inputs). */
export function utcToZonedDate(iso: string | Date, timeZone: string): string {
  return utcToZonedInput(iso, timeZone).slice(0, 10);
}

/** Adds whole days to a "YYYY-MM-DD" calendar date. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
