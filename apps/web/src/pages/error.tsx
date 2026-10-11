// web-54 Connection interrupted. Shows the real last successful sync (kept in memory and
// localStorage by the API client), the last failed request, and Retry which re-runs that
// request (GET only — mutations are never replayed automatically) plus an API liveness check.
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { http, type ApiError } from '../api/client';
import { connectivity } from '../api/connectivity';
import { endpoints } from '../api/endpoints';
import { errorMessageKey, toApiError } from '../api/hooks';
import type { Dashboard } from '../api/types';
import { Icon } from '../components/Icon';
import { PageHeader } from '../components/PageHeader';
import { Button, ButtonLink, Card, KeyValueList, Notice, StatusPill } from '../components/primitives';
import { useConnectivity } from '../hooks/useConnectivity';
import { useI18n } from '../i18n';
import { safeNext } from '../lib/nav';
import { useSession } from '../session/SessionProvider';

type RetryState = { kind: 'idle' } | { kind: 'running' } | { kind: 'ok'; dashboard: Dashboard | null } | { kind: 'failed'; error: ApiError };

export default function ConnectionErrorPage() {
  const { t, fmt } = useI18n();
  const { store, timeZone, can, reload: reloadSession, status: sessionStatus } = useSession();
  const snap = useConnectivity();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const from = params.get('from');
  const [retry, setRetry] = useState<RetryState>({ kind: 'idle' });

  const runRetry = async () => {
    setRetry({ kind: 'running' });
    try {
      const failed = snap.lastFailure;
      // Re-run the failed request when it was a read; never replay a command.
      if (failed && failed.method === 'GET') await http.get<unknown>(failed.path);
      else await endpoints.health.live();
      let dashboard: Dashboard | null = null;
      if (store && can('dashboard.read')) dashboard = await endpoints.dashboard(store.id);
      connectivity.clearFailure();
      if (sessionStatus === 'error') reloadSession();
      setRetry({ kind: 'ok', dashboard });
    } catch (e) {
      setRetry({ kind: 'failed', error: toApiError(e) });
    }
  };

  const lastSync = snap.lastSuccessAt;
  const failure = snap.lastFailure;
  const back = safeNext(from, '/web/dashboard');

  return (
    <>
      <PageHeader
        screenId="web-54"
        action={
          <Button icon="refresh" onClick={() => void runRetry()} pending={retry.kind === 'running'}>
            {t('Retry')}
          </Button>
        }
      />
      <div className="grid">
        <Card title={t('Connection status')}>
          <div className="error-hero">
            <Icon name={retry.kind === 'ok' ? 'check' : 'wifiOff'} size={36} />
            <div>
              {retry.kind === 'ok' ? (
                <StatusPill tone="ok">{t('Connection restored')}</StatusPill>
              ) : snap.online && !failure ? (
                <StatusPill tone="ok">{t('No connection problem detected')}</StatusPill>
              ) : (
                <StatusPill tone="critical">{t('Connection interrupted')}</StatusPill>
              )}
            </div>
          </div>
          <KeyValueList
            items={[
              {
                label: t('Last successful sync'),
                value: lastSync ? (
                  <>
                    {fmt.dateTime(lastSync, timeZone, { withZone: true })} <span className="muted">· {fmt.relative(lastSync)}</span>
                  </>
                ) : (
                  t('No successful sync recorded in this browser')
                ),
              },
              ...(failure
                ? [
                    { label: t('Failed request'), value: <span className="mono">{`${failure.method} ${failure.path.split('?')[0]}`}</span> },
                    { label: t('Error'), value: `${t(errorMessageKey(failure.error))} (${failure.error.code})` },
                    { label: t('Failed at'), value: fmt.dateTime(failure.at, timeZone, { withZone: true }) },
                    ...(failure.error.requestId ? [{ label: t('Request ID'), value: <span className="mono">{failure.error.requestId}</span> }] : []),
                  ]
                : []),
            ]}
          />
          {retry.kind === 'failed' ? (
            <div className="form-error" role="alert">
              {t('Still unable to reach the server.')} {`(${retry.error.code})`}
              {retry.error.requestId ? ` · ${t('Request ID')}: ${retry.error.requestId}` : ''}
            </div>
          ) : null}
          {retry.kind === 'ok' ? (
            <div className="state-actions">
              <Button onClick={() => navigate(back)}>{t('Continue where you left off')}</Button>
            </div>
          ) : null}
        </Card>
        <Card title={t('Local monitoring')}>
          {retry.kind === 'ok' && retry.dashboard ? (
            <KeyValueList
              items={[
                {
                  label: t('Monitoring active'),
                  value: (() => {
                    const total = retry.dashboard.camera_health.length;
                    const n = retry.dashboard.camera_health.filter((c) => c.analysis_state === 'analyzing').length;
                    return total === 0 ? (
                      <StatusPill tone="warning">{t('No cameras added')}</StatusPill>
                    ) : n > 0 ? (
                      <StatusPill tone="ok">{t('{n} of {total} cameras analyzing', { n, total })}</StatusPill>
                    ) : (
                      <StatusPill tone="critical">{t('No camera is analyzing')}</StatusPill>
                    );
                  })(),
                },
                { label: t('Last synchronized'), value: fmt.dateTime(retry.dashboard.last_refresh, timeZone, { withZone: true }) },
              ]}
            />
          ) : (
            <Notice tone="info">
              {t('Store edge appliances analyze video locally and queue alerts while the console is disconnected, if they were online before the interruption. This browser cannot confirm their state until the connection returns.')}
            </Notice>
          )}
          <p className="muted small">
            {t('Commands are never replayed automatically. After reconnecting, reload records before acting so you see changes made by others.')}
          </p>
          <div className="state-actions">
            {can('support.create') ? <ButtonLink to="/web/support">{t('Diagnostics')}</ButtonLink> : null}
            {can('health.read') ? <ButtonLink to="/web/health">{t('System health')}</ButtonLink> : null}
            <Link to={back} className="link-sm">
              {t('Back to previous page')}
            </Link>
          </div>
        </Card>
      </div>
    </>
  );
}
