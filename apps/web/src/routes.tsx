// Route table: screen id -> lazy page component. To implement a screen:
//   1. create src/pages/<key>.tsx with a default-exported component (see FOUNDATION.md)
//   2. add one line below:  'web-23': lazy(() => import('./pages/incidents')),
// Screens without an entry render <NotYetImplemented> (with the page header) automatically.
import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { ScreenId } from './screens.generated';
import { PAGES_B } from './routes.group-b';
import { PAGES_C } from './routes.group-c';
import { PAGES_D } from './routes.group-d';

export type PageComponent = LazyExoticComponent<ComponentType>;

export const PAGES: Partial<Record<ScreenId, PageComponent>> = {
  'web-01': lazy(() => import('./pages/login')),
  'web-02': lazy(() => import('./pages/mfa')),
  'web-03': lazy(() => import('./pages/reset')),
  'web-09': lazy(() => import('./pages/dashboard')),
  'web-19': lazy(() => import('./pages/alerts')),
  'web-20': lazy(() => import('./pages/alert-detail')),
  'web-53': lazy(() => import('./pages/empty')),
  'web-54': lazy(() => import('./pages/error')),
  ...PAGES_B,
  ...PAGES_C,
  ...PAGES_D,
};

/** Non-catalog public page used by the invitation flow (/web/invite?token=...). */
export const InvitePage: PageComponent = lazy(() => import('./pages/invite'));
