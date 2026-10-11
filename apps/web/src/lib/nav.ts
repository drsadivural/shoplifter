/** Only same-origin app paths are accepted as ?next= targets (prevents open redirects). */
export function safeNext(next: string | null | undefined, fallback = '/web/dashboard'): string {
  if (!next) return fallback;
  if (!next.startsWith('/web/') || next.startsWith('//') || next.includes('\\')) return fallback;
  if (/^\/web\/(login|mfa|reset|invite)\b/.test(next)) return fallback;
  return next;
}
