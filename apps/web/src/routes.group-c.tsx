// Route entries for screen group C. Merged into PAGES in routes.tsx.
import { lazy } from 'react';
import type { ScreenId } from './screens.generated';
import type { PageComponent } from './routes';

export const PAGES_C: Partial<Record<ScreenId, PageComponent>> = {
  'web-21': lazy(() => import('./pages/alert-outcome')),
  'web-22': lazy(() => import('./pages/alert-escalation')),
  'web-23': lazy(() => import('./pages/incidents')),
  'web-24': lazy(() => import('./pages/incident-detail')),
  'web-25': lazy(() => import('./pages/cases')),
  'web-26': lazy(() => import('./pages/case-detail')),
  'web-35': lazy(() => import('./pages/search')),
  'web-36': lazy(() => import('./pages/search-results')),
  'web-37': lazy(() => import('./pages/visit-detail')),
  'web-38': lazy(() => import('./pages/checkout')),
  'web-39': lazy(() => import('./pages/checkout-detail')),
  'web-40': lazy(() => import('./pages/integrations')),
  'web-41': lazy(() => import('./pages/reports')),
  'web-42': lazy(() => import('./pages/report-export')),
};
