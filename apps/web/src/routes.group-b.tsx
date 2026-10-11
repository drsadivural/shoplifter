// Route entries for screen group B. Merged into PAGES in routes.tsx.
import { lazy } from 'react';
import type { ScreenId } from './screens.generated';
import type { PageComponent } from './routes';

export const PAGES_B: Partial<Record<ScreenId, PageComponent>> = {
  'web-04': lazy(() => import('./pages/organization')),
  'web-05': lazy(() => import('./pages/stores')),
  'web-06': lazy(() => import('./pages/store-detail')),
  'web-07': lazy(() => import('./pages/store-add')),
  'web-08': lazy(() => import('./pages/edge-pair')),
  'web-10': lazy(() => import('./pages/live')),
  'web-11': lazy(() => import('./pages/camera-discovery')),
  'web-12': lazy(() => import('./pages/camera-add')),
  'web-13': lazy(() => import('./pages/camera-import')),
  'web-14': lazy(() => import('./pages/cameras')),
  'web-15': lazy(() => import('./pages/camera-detail')),
  'web-16': lazy(() => import('./pages/zones')),
  'web-17': lazy(() => import('./pages/detection-rules')),
  'web-18': lazy(() => import('./pages/calibration')),
  'web-47': lazy(() => import('./pages/health')),
  'web-48': lazy(() => import('./pages/models')),
};
