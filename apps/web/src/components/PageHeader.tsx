// Page header pattern from the designs:
//   eyebrow "AYONIX · RETAIL OPERATIONS"
//   h1 = localized screen title from design/screens.json
//   subtitle "<store> · Review evidence. Respond with confidence."
//   primary page action top-right
import { useEffect, type ReactNode } from 'react';
import { useI18n } from '../i18n';
import { getScreen } from '../routes.meta';
import type { ScreenId } from '../screens.generated';
import { useSession } from '../session/SessionProvider';

export function PageHeader({
  screenId,
  title,
  subtitle,
  action,
}: {
  screenId: ScreenId;
  /** Override the catalog title (e.g. a record reference). */
  title?: string;
  /** Override the default subtitle. */
  subtitle?: ReactNode;
  /** Primary page action(s), right-aligned. */
  action?: ReactNode;
}) {
  const { t, locale } = useI18n();
  const { store } = useSession();
  const screen = getScreen(screenId);
  const heading = title ?? screen.title[locale];
  useEffect(() => {
    document.title = `${heading} · RetailGuard`;
  }, [heading]);
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">AYONIX · RETAIL OPERATIONS</div>
        <h1 id="page-title" tabIndex={-1}>
          {heading}
        </h1>
        <p className="page-subtitle">
          {subtitle ?? (
            <>
              {store ? `${store.name} · ` : ''}
              {t('Review evidence. Respond with confidence.')}
            </>
          )}
        </p>
      </div>
      {action ? <div className="page-actions">{action}</div> : null}
    </div>
  );
}
