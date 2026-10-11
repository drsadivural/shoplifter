// Route metadata for all 54 web screens: required permission, layout, breadcrumb section and
// which sidebar item is highlighted. Components live in src/routes.tsx (lazy imports).
import type { Permission } from './api/types';
import type { IconName } from './components/Icon';
import { WEB_SCREENS, type ScreenDef, type ScreenId } from './screens.generated';

export type Layout =
  /** Signed-out pages (no shell, no /v1/me). */
  | 'public'
  /** Signed-in pages inside the app shell. */
  | 'app'
  /** Inside the shell but must render even when /v1/me cannot be loaded (web-54). */
  | 'app-degraded';

export type Section = 'operations' | 'administration' | 'auth';

export interface RouteMeta {
  permission?: Permission;
  layout: Layout;
  section: Section;
  /** Sidebar item highlighted for this screen (defaults to itself). */
  navParent?: ScreenId;
}

export const ROUTE_META: Record<ScreenId, RouteMeta> = {
  'web-01': { layout: 'public', section: 'auth' },
  'web-02': { layout: 'public', section: 'auth' },
  'web-03': { layout: 'public', section: 'auth' },
  'web-04': { layout: 'app', section: 'administration', permission: 'org.manage', navParent: 'web-49' },
  'web-05': { layout: 'app', section: 'administration', permission: 'store.read', navParent: 'web-49' },
  'web-06': { layout: 'app', section: 'administration', permission: 'store.read', navParent: 'web-49' },
  'web-07': { layout: 'app', section: 'administration', permission: 'store.manage', navParent: 'web-49' },
  'web-08': { layout: 'app', section: 'administration', permission: 'edge.manage', navParent: 'web-14' },
  'web-09': { layout: 'app', section: 'operations', permission: 'dashboard.read' },
  'web-10': { layout: 'app', section: 'operations', permission: 'camera.read' },
  'web-11': { layout: 'app', section: 'administration', permission: 'camera.manage', navParent: 'web-14' },
  'web-12': { layout: 'app', section: 'administration', permission: 'camera.manage', navParent: 'web-14' },
  'web-13': { layout: 'app', section: 'administration', permission: 'camera.manage', navParent: 'web-14' },
  'web-14': { layout: 'app', section: 'administration', permission: 'camera.read' },
  'web-15': { layout: 'app', section: 'administration', permission: 'camera.read', navParent: 'web-14' },
  'web-16': { layout: 'app', section: 'administration', permission: 'camera.manage', navParent: 'web-14' },
  'web-17': { layout: 'app', section: 'administration', permission: 'policy.manage', navParent: 'web-49' },
  'web-18': { layout: 'app', section: 'administration', permission: 'policy.manage', navParent: 'web-49' },
  'web-19': { layout: 'app', section: 'operations', permission: 'incident.read' },
  'web-20': { layout: 'app', section: 'operations', permission: 'incident.read', navParent: 'web-19' },
  'web-21': { layout: 'app', section: 'operations', permission: 'incident.respond', navParent: 'web-19' },
  'web-22': { layout: 'app', section: 'administration', permission: 'policy.manage', navParent: 'web-49' },
  'web-23': { layout: 'app', section: 'operations', permission: 'incident.read' },
  'web-24': { layout: 'app', section: 'operations', permission: 'incident.read', navParent: 'web-23' },
  'web-25': { layout: 'app', section: 'operations', permission: 'case.read' },
  'web-26': { layout: 'app', section: 'operations', permission: 'case.read', navParent: 'web-25' },
  'web-27': { layout: 'app', section: 'operations', permission: 'profile.read' },
  'web-28': { layout: 'app', section: 'operations', permission: 'watchlist.manage', navParent: 'web-27' },
  'web-29': { layout: 'app', section: 'operations', permission: 'profile.read', navParent: 'web-27' },
  'web-30': { layout: 'app', section: 'operations', permission: 'watchlist.approve', navParent: 'web-27' },
  'web-31': { layout: 'app', section: 'operations', permission: 'profile.read' },
  'web-32': { layout: 'app', section: 'operations', permission: 'staff.manage', navParent: 'web-31' },
  'web-33': { layout: 'app', section: 'operations', permission: 'profile.read', navParent: 'web-31' },
  'web-34': { layout: 'app', section: 'operations', permission: 'photo.read', navParent: 'web-31' },
  'web-35': { layout: 'app', section: 'operations', permission: 'search.metadata' },
  'web-36': { layout: 'app', section: 'operations', permission: 'search.metadata', navParent: 'web-35' },
  'web-37': { layout: 'app', section: 'operations', permission: 'incident.read', navParent: 'web-35' },
  'web-38': { layout: 'app', section: 'operations', permission: 'incident.read', navParent: 'web-19' },
  'web-39': { layout: 'app', section: 'operations', permission: 'incident.read', navParent: 'web-19' },
  'web-40': { layout: 'app', section: 'administration', permission: 'integration.manage', navParent: 'web-49' },
  'web-41': { layout: 'app', section: 'operations', permission: 'report.read' },
  'web-42': { layout: 'app', section: 'operations', permission: 'export.create', navParent: 'web-25' },
  'web-43': { layout: 'app', section: 'administration', permission: 'user.manage' },
  'web-44': { layout: 'app', section: 'administration', permission: 'user.manage', navParent: 'web-43' },
  'web-45': { layout: 'app', section: 'administration', permission: 'user.manage', navParent: 'web-43' },
  'web-46': { layout: 'app', section: 'administration', permission: 'audit.read' },
  'web-47': { layout: 'app', section: 'administration', permission: 'health.read', navParent: 'web-46' },
  'web-48': { layout: 'app', section: 'administration', permission: 'model.manage', navParent: 'web-49' },
  // Personal preferences (language/appearance) are on web-49; org-level fields check org.manage in-page.
  'web-49': { layout: 'app', section: 'administration' },
  'web-50': { layout: 'app', section: 'administration', permission: 'privacy.manage', navParent: 'web-49' },
  'web-51': { layout: 'app', section: 'administration', navParent: 'web-49' },
  'web-52': { layout: 'app', section: 'administration', permission: 'support.create', navParent: 'web-49' },
  'web-53': { layout: 'app', section: 'operations', permission: 'incident.read', navParent: 'web-19' },
  'web-54': { layout: 'app-degraded', section: 'operations' },
};

export interface NavItem {
  screenId: ScreenId;
  /** i18n key (context-qualified "nav|..."). */
  labelKey: string;
  icon: IconName;
}

export interface NavGroup {
  /** i18n key for the group heading. */
  labelKey: string;
  items: NavItem[];
}

/** Sidebar, exactly as the designs: OPERATIONS + ADMINISTRATION. Items hide without permission. */
export const NAV: NavGroup[] = [
  {
    labelKey: 'nav|Operations',
    items: [
      { screenId: 'web-09', labelKey: 'nav|Dashboard', icon: 'dashboard' },
      { screenId: 'web-10', labelKey: 'nav|Live cameras', icon: 'live' },
      { screenId: 'web-19', labelKey: 'nav|Alerts', icon: 'alerts' },
      { screenId: 'web-23', labelKey: 'nav|Incidents', icon: 'incidents' },
      { screenId: 'web-25', labelKey: 'nav|Cases', icon: 'cases' },
      { screenId: 'web-27', labelKey: 'nav|Watchlist', icon: 'watchlist' },
      { screenId: 'web-31', labelKey: 'nav|Staff', icon: 'staff' },
      { screenId: 'web-35', labelKey: 'nav|Search records', icon: 'search' },
      { screenId: 'web-41', labelKey: 'nav|Reports', icon: 'reports' },
    ],
  },
  {
    labelKey: 'nav|Administration',
    items: [
      { screenId: 'web-14', labelKey: 'nav|Cameras', icon: 'cameras' },
      { screenId: 'web-43', labelKey: 'nav|Users', icon: 'users' },
      { screenId: 'web-46', labelKey: 'nav|Events & audit', icon: 'audit' },
      { screenId: 'web-49', labelKey: 'nav|Settings', icon: 'settings' },
    ],
  },
];

const BY_ID = new Map<string, ScreenDef>(WEB_SCREENS.map((s) => [s.id, s]));
const BY_ROUTE = new Map<string, ScreenDef>(WEB_SCREENS.map((s) => [s.route, s]));

export function getScreen(id: ScreenId): ScreenDef {
  const s = BY_ID.get(id);
  if (!s) throw new Error(`Unknown screen ${id}`);
  return s;
}

export function screenForPath(pathname: string): ScreenDef | undefined {
  return BY_ROUTE.get(pathname.replace(/\/+$/, ''));
}

/** Path for a screen id with optional query, e.g. screenPath('web-20', { id }) -> /web/alert-detail?id=... */
export function screenPath(id: ScreenId, query?: Record<string, string | undefined | null>): string {
  const route = getScreen(id).route;
  if (!query) return route;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v) q.set(k, v);
  const qs = q.toString();
  return qs ? `${route}?${qs}` : route;
}

/** Extra non-catalog public route needed by the invitation flow. */
export const INVITE_ROUTE = '/web/invite';
