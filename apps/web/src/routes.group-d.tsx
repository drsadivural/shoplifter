// Route entries for screen group D. Merged into PAGES in routes.tsx.
import { lazy } from 'react';
import type { ScreenId } from './screens.generated';
import type { PageComponent } from './routes';

export const PAGES_D: Partial<Record<ScreenId, PageComponent>> = {
  'web-27': lazy(() => import('./pages/watchlist')),
  'web-28': lazy(() => import('./pages/watchlist-enroll')),
  'web-29': lazy(() => import('./pages/watchlist-detail')),
  'web-30': lazy(() => import('./pages/watchlist-approval')),
  'web-31': lazy(() => import('./pages/staff')),
  'web-32': lazy(() => import('./pages/staff-enroll')),
  'web-33': lazy(() => import('./pages/staff-detail')),
  'web-34': lazy(() => import('./pages/photos')),
  'web-43': lazy(() => import('./pages/users')),
  'web-44': lazy(() => import('./pages/user-invite')),
  'web-45': lazy(() => import('./pages/roles')),
  'web-46': lazy(() => import('./pages/logs')),
  'web-49': lazy(() => import('./pages/settings')),
  'web-50': lazy(() => import('./pages/privacy')),
  'web-51': lazy(() => import('./pages/notifications')),
  'web-52': lazy(() => import('./pages/support')),
};
