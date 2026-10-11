// Date/time/number helpers. API timestamps are RFC 3339 UTC; always display them in the
// STORE timezone (store.timezone, e.g. "Asia/Tokyo"), never the browser timezone.
import type { Locale } from '../api/types';

const intlLocale = (locale: Locale) => (locale === 'ja' ? 'ja-JP' : 'en-GB');

function parse(iso: string | Date | null | undefined): Date | null {
  if (!iso) return null;
  const d = iso instanceof Date ? iso : new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parts(d: Date, timeZone: string): Record<string, string> {
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
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(d)) out[p.type] = p.value;
  if (out.hour === '24') out.hour = '00';
  return out;
}

const KNOWN_ABBR: Record<string, string> = {
  'Asia/Tokyo': 'JST',
  'Asia/Seoul': 'KST',
  'Asia/Shanghai': 'CST',
  'Asia/Taipei': 'CST',
  'Asia/Hong_Kong': 'HKT',
  'Asia/Singapore': 'SGT',
  UTC: 'UTC',
  'Etc/UTC': 'UTC',
};

/** Short timezone label: "JST", "PDT", or "GMT+9" when no common abbreviation exists. */
export function tzAbbr(timeZone: string, at: Date = new Date()): string {
  const known = KNOWN_ABBR[timeZone];
  if (known) return known;
  try {
    const p = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' }).formatToParts(at);
    return p.find((x) => x.type === 'timeZoneName')?.value ?? timeZone;
  } catch {
    return timeZone;
  }
}

export interface DateFormatOptions {
  /** Append the timezone abbreviation, e.g. "2026-10-11 10:42:18 JST". */
  withZone?: boolean;
  /** Include seconds (default true for date-time, false for time). */
  seconds?: boolean;
}

/** "2026-10-11 10:42:18" in the store timezone (ISO-like in both languages, as in the designs). */
export function formatDateTime(iso: string | Date | null | undefined, timeZone: string, opts: DateFormatOptions = {}): string {
  const d = parse(iso);
  if (!d) return '—';
  const p = parts(d, timeZone);
  const time = opts.seconds === false ? `${p.hour}:${p.minute}` : `${p.hour}:${p.minute}:${p.second}`;
  const s = `${p.year}-${p.month}-${p.day} ${time}`;
  return opts.withZone ? `${s} ${tzAbbr(timeZone, d)}` : s;
}

/** "10:42" (or "10:42:18" with seconds) in the store timezone. */
export function formatTime(iso: string | Date | null | undefined, timeZone: string, opts: DateFormatOptions = {}): string {
  const d = parse(iso);
  if (!d) return '—';
  const p = parts(d, timeZone);
  const s = opts.seconds ? `${p.hour}:${p.minute}:${p.second}` : `${p.hour}:${p.minute}`;
  return opts.withZone ? `${s} ${tzAbbr(timeZone, d)}` : s;
}

/** "2026-10-11" in the store timezone. */
export function formatDate(iso: string | Date | null | undefined, timeZone: string): string {
  const d = parse(iso);
  if (!d) return '—';
  const p = parts(d, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Calendar date key "YYYY-MM-DD" (e.g. dashboard trend) -> short weekday ("Mon" / "月"). */
export function formatWeekday(dateKey: string, locale: Locale): string {
  const d = parse(`${dateKey}T12:00:00Z`);
  if (!d) return dateKey;
  return new Intl.DateTimeFormat(intlLocale(locale), { weekday: 'short', timeZone: 'UTC' }).format(d);
}

/** Calendar date key "YYYY-MM-DD" -> "10/11" (en) / "10/11" (ja). */
export function formatMonthDay(dateKey: string, locale: Locale): string {
  const d = parse(`${dateKey}T12:00:00Z`);
  if (!d) return dateKey;
  return new Intl.DateTimeFormat(locale === 'ja' ? 'ja-JP' : 'en-US', { month: 'numeric', day: 'numeric', timeZone: 'UTC' }).format(d);
}

/** Relative time: "5 min ago" / "5 分前". Future times read "in 5 min". */
export function formatRelative(iso: string | Date | null | undefined, locale: Locale, now: Date = new Date()): string {
  const d = parse(iso);
  if (!d) return '—';
  const diffS = Math.round((d.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(diffS);
  const rtf = new Intl.RelativeTimeFormat(locale === 'ja' ? 'ja' : 'en', { numeric: 'auto', style: 'short' });
  if (abs < 45) return locale === 'ja' ? 'たった今' : 'just now';
  if (abs < 45 * 60) return rtf.format(Math.round(diffS / 60), 'minute');
  if (abs < 22 * 3600) return rtf.format(Math.round(diffS / 3600), 'hour');
  if (abs < 26 * 86400) return rtf.format(Math.round(diffS / 86400), 'day');
  if (abs < 320 * 86400) return rtf.format(Math.round(diffS / (30 * 86400)), 'month');
  return rtf.format(Math.round(diffS / (365 * 86400)), 'year');
}

/** Durations such as median acknowledgement: "14 s", "3 min 05 s", "1 h 02 min". */
export function formatDuration(seconds: number | null | undefined, locale: Locale): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '—';
  const s = Math.max(0, Math.round(seconds));
  const ja = locale === 'ja';
  if (s < 60) return ja ? `${s}秒` : `${s} s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return ja ? `${m}分${String(rs).padStart(2, '0')}秒` : `${m} min ${String(rs).padStart(2, '0')} s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return ja ? `${h}時間${String(rm).padStart(2, '0')}分` : `${h} h ${String(rm).padStart(2, '0')} min`;
}

export function formatNumber(n: number | null | undefined, locale: Locale, opts?: Intl.NumberFormatOptions): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return new Intl.NumberFormat(intlLocale(locale), opts).format(n);
}

export function formatPercent(fraction: number | null | undefined, locale: Locale, digits = 1): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return '—';
  return new Intl.NumberFormat(intlLocale(locale), { style: 'percent', maximumFractionDigits: digits }).format(fraction);
}

/** Currency (JPY default, no minor units): "¥12,800" / "￥12,800". */
export function formatCurrency(amount: number | null | undefined, locale: Locale, currency = 'JPY'): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return '—';
  return new Intl.NumberFormat(locale === 'ja' ? 'ja-JP' : 'en-US', { style: 'currency', currency }).format(amount);
}

/** Bytes: "8 MB". */
export function formatBytes(bytes: number | null | undefined, locale: Locale): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${formatNumber(v, locale, { maximumFractionDigits: v < 10 && i > 0 ? 1 : 0 })} ${units[i]}`;
}
