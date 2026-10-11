// web-53 No alerts to review. Real monitoring status from GET /v1/dashboard?store_id=:
// whether cameras are actually analyzing, last refresh, and camera health. No synthetic data.
import { Link } from 'react-router';
import { endpoints } from '../api/endpoints';
import { useApiQuery } from '../api/hooks';
import type { Dashboard } from '../api/types';
import { AnalysisStatePill, ReadinessPill } from '../components/domain';
import { Icon } from '../components/Icon';
import { PageHeader } from '../components/PageHeader';
import { Button, ButtonLink, Card, KeyValueList, Notice, StatusPill } from '../components/primitives';
import { RouteStateBoundary } from '../components/RouteStateBoundary';
import { EmptyState } from '../components/states';
import { useI18n } from '../i18n';
import { screenPath } from '../routes.meta';
import { useSession } from '../session/SessionProvider';

export default function EmptyAlertsPage() {
  const { t } = useI18n();
  const { store } = useSession();
  const q = useApiQuery((signal) => endpoints.dashboard(store?.id, { signal }), [store?.id], { enabled: Boolean(store), pollMs: 60_000 });
  return (
    <>
      <PageHeader
        screenId="web-53"
        action={
          <Button variant="secondary" icon="refresh" onClick={q.reload} pending={q.fetching && q.data !== undefined}>
            {t('Refresh')}
          </Button>
        }
      />
      {!store ? (
        <EmptyState icon="info" title={t('No stores assigned')} description={t('Ask an administrator to assign you to a store.')} />
      ) : (
        <RouteStateBoundary query={q} permission="incident.read">
          {(d) => <MonitoringPanel data={d} />}
        </RouteStateBoundary>
      )}
    </>
  );
}

export function MonitoringPanel({ data }: { data: Dashboard }) {
  const { t, fmt } = useI18n();
  const { timeZone } = useSession();
  const total = data.camera_health.length;
  const analyzing = data.camera_health.filter((c) => c.analysis_state === 'analyzing').length;
  const open = data.open_alerts;
  return (
    <div className="empty-layout">
      {open !== null && open > 0 ? (
        <Notice tone="warning" title={t('There are unresolved alerts')}>
          {t('{n} alerts still need review for this store.', { n: open })}{' '}
          <Link to="/web/alerts">{t('Open alert inbox')}</Link>
        </Notice>
      ) : null}
      <div className="card empty-card">
        <div className="big-icon" aria-hidden="true">
          <Icon name="check" size={40} />
        </div>
        <h2>{open === 0 ? t('No alerts to review') : open === null ? t('Alert count unavailable') : t('Monitoring status')}</h2>
        <p className="muted">
          {open === 0
            ? t('Every alert for this store has been reviewed. New alerts appear in the inbox as soon as the store edge reports them.')
            : open === null
              ? t('The alert count could not be computed. Check the alert inbox directly.')
              : t('Review the remaining alerts in the inbox.')}
        </p>
        <KeyValueList
          items={[
            {
              label: t('Monitoring active'),
              value:
                total === 0 ? (
                  <StatusPill tone="warning">{t('No cameras added')}</StatusPill>
                ) : analyzing > 0 ? (
                  <StatusPill tone="ok">{t('{n} of {total} cameras analyzing', { n: analyzing, total })}</StatusPill>
                ) : (
                  <StatusPill tone="critical">{t('No camera is analyzing')}</StatusPill>
                ),
            },
            { label: t('Last synchronized'), value: fmt.dateTime(data.last_refresh, timeZone, { withZone: true }) },
          ]}
        />
        <div className="state-actions">
          <ButtonLink to="/web/incidents" variant="primary">
            {t('View history')}
          </ButtonLink>
          <ButtonLink to="/web/cameras">{t('Camera inventory')}</ButtonLink>
        </div>
      </div>
      <Card title={t('Camera health')}>
        {total === 0 ? (
          <EmptyState compact icon="cameras" title={t('No cameras added yet')} />
        ) : (
          <ul className="rows">
            {data.camera_health.map((c) => (
              <li key={c.id} className="row">
                <div className="row-main">
                  <Link to={screenPath('web-15', { id: c.id })} className="row-title-plain">
                    {c.name}
                  </Link>
                  <div className="help">
                    {t('Last frame')}: {c.last_frame_at ? fmt.relative(c.last_frame_at) : t('none received')}
                  </div>
                </div>
                <ReadinessPill readiness={c.readiness} />
                <AnalysisStatePill state={c.analysis_state} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
