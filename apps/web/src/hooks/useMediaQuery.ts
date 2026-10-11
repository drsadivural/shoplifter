import { useEffect, useState } from 'react';

/** Responsive breakpoints (keep in sync with styles/*.css). */
export const BREAKPOINTS = {
  /** ≤ 767px: phones (390 target) — single column, tables render as cards. */
  mobile: '(max-width: 767px)',
  /** ≤ 1023px: tablets (768 target) — sidebar becomes a drawer. */
  drawer: '(max-width: 1023px)',
  /** ≤ 1279px: small laptops (1024 target) — compact sidebar. */
  compact: '(max-width: 1279px)',
} as const;

export function useMediaQuery(query: string): boolean {
  const get = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false);
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, [query]);
  return matches;
}
