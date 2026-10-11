import { describe, expect, it } from 'vitest';
import { formatCurrency, formatDate, formatDateTime, formatDuration, formatRelative, formatTime, tzAbbr } from './format';

describe('store-timezone formatting', () => {
  const iso = '2026-10-11T01:42:18Z';

  it('formats UTC timestamps in the store timezone, not the browser timezone', () => {
    expect(formatDateTime(iso, 'Asia/Tokyo')).toBe('2026-10-11 10:42:18');
    expect(formatDateTime(iso, 'Asia/Tokyo', { withZone: true })).toBe('2026-10-11 10:42:18 JST');
    expect(formatDateTime(iso, 'America/Los_Angeles')).toBe('2026-10-10 18:42:18');
    expect(formatDateTime(iso, 'UTC')).toBe('2026-10-11 01:42:18');
  });

  it('formats time and date parts', () => {
    expect(formatTime(iso, 'Asia/Tokyo')).toBe('10:42');
    expect(formatTime(iso, 'Asia/Tokyo', { seconds: true, withZone: true })).toBe('10:42:18 JST');
    expect(formatDate('2026-10-10T16:30:00Z', 'Asia/Tokyo')).toBe('2026-10-11');
    expect(formatDate('2026-10-10T16:30:00Z', 'Europe/London')).toBe('2026-10-10');
  });

  it('handles midnight as 00 and missing values as an em dash', () => {
    expect(formatTime('2026-10-10T15:00:00Z', 'Asia/Tokyo')).toBe('00:00');
    expect(formatDateTime(null, 'Asia/Tokyo')).toBe('—');
    expect(formatDateTime('not-a-date', 'Asia/Tokyo')).toBe('—');
  });

  it('gives a timezone abbreviation', () => {
    expect(tzAbbr('Asia/Tokyo')).toBe('JST');
    expect(tzAbbr('America/New_York', new Date('2026-01-15T00:00:00Z'))).toBe('EST');
  });

  it('formats relative times in both languages', () => {
    const now = new Date('2026-10-11T01:50:00Z');
    expect(formatRelative('2026-10-11T01:45:00Z', 'en', now)).toBe('5 min. ago');
    expect(formatRelative('2026-10-11T01:45:00Z', 'ja', now)).toBe('5 分前');
    expect(formatRelative('2026-10-11T01:49:50Z', 'en', now)).toBe('just now');
    expect(formatRelative('2026-10-11T00:50:00Z', 'en', now)).toBe('1 hr. ago');
  });

  it('formats durations and JPY', () => {
    expect(formatDuration(14, 'en')).toBe('14 s');
    expect(formatDuration(185, 'en')).toBe('3 min 05 s');
    expect(formatDuration(14, 'ja')).toBe('14秒');
    expect(formatDuration(null, 'en')).toBe('—');
    expect(formatCurrency(12800, 'en')).toBe('¥12,800');
    expect(formatCurrency(12800, 'ja')).toBe('￥12,800');
    expect(formatCurrency(null, 'ja')).toBe('—');
  });
});
