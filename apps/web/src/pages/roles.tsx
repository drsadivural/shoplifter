// web-45 Roles & permissions. GET /v1/roles -> {roles, actions:[{action, roles}]}: a read-only
// matrix of the fixed roles enforced by the server. Roles are assigned per user in web-43.
import '../styles/group-d.css';
import { endpoints } from '../api/endpoints';
import { useApiQuery } from '../api/hooks';
import { PageHeader } from '../components/PageHeader';
import { ButtonLink, Card, Notice } from '../components/primitives';
import { RouteStateBoundary } from '../components/RouteStateBoundary';
import { EmptyState } from '../components/states';
import { hasTranslation, useI18n } from '../i18n';
import { screenPath } from '../routes.meta';

export const PERMISSION_LABEL: Record<string, string> = {
  'dashboard.read': 'perm|View the dashboard',
  'incident.read': 'perm|View alerts, incidents and evidence',
  'incident.create': 'perm|Report an incident manually',
  'incident.respond': 'perm|Acknowledge alerts and record outcomes',
  'incident.reopen': 'perm|Reopen resolved incidents',
  'case.read': 'perm|View cases',
  'case.manage': 'perm|Create and manage cases',
  'export.create': 'perm|Export evidence bundles',
  'search.metadata': 'perm|Search past records',
  'search.photo': 'perm|Search by reference photo',
  'profile.read': 'perm|View watchlist and staff profiles',
  'staff.manage': 'perm|Enroll and manage staff (including staff photos)',
  'watchlist.manage': 'perm|Enroll and manage watchlist subjects',
  'watchlist.approve': 'perm|Approve watchlist enrollments',
  'photo.read': 'perm|View watchlist reference photos',
  'camera.read': 'perm|View cameras and live view',
  'camera.manage': 'perm|Add, configure and activate cameras',
  'edge.manage': 'perm|Pair and revoke edge appliances',
  'store.read': 'perm|View stores',
  'store.manage': 'perm|Edit store details',
  'policy.manage': 'perm|Change detection, escalation and notification policies',
  'integration.manage': 'perm|Manage POS, RFID and VMS connections',
  'report.read': 'perm|View reports',
  'audit.read': 'perm|View the audit log',
  'user.manage': 'perm|Invite and manage users',
  'org.manage': 'perm|Manage organization settings and stores',
  'model.manage': 'perm|Manage model rollout',
  'privacy.manage': 'perm|Manage retention, legal holds and privacy requests',
  'health.read': 'perm|View system health',
  'support.create': 'perm|Create support diagnostics',
};

export default function RolesPage() {
  const { t, locale } = useI18n();
  const q = useApiQuery((signal) => endpoints.roles({ signal }), []);
  const cfg = useApiQuery((signal) => endpoints.auth.config({ signal }), []);
  // Organization admins can switch the requirement off (Settings › Organization settings).
  const general = useApiQuery((signal) => endpoints.org.getSettings('general', { signal }), []);
  const label = (action: string) => {
    const key = PERMISSION_LABEL[action];
    return key && (hasTranslation(locale, key) || hasTranslation('en', key)) ? t(key) : action;
  };

  return (
    <>
      <PageHeader
        screenId="web-45"
        action={
          <ButtonLink to={screenPath('web-43')} variant="secondary">
            {t('Assign roles in User management')}
          </ButtonLink>
        }
      />
      <Notice tone="info">
        {t('Roles are fixed and enforced by the server for every request, within each person’s assigned stores. To change what someone can do, assign a different role in User management.')}
      </Notice>
      <RouteStateBoundary query={q} isEmpty={(d) => d.actions.length === 0} empty={<EmptyState title={t('No permissions were returned')} />}>
        {(data) => (
          <Card className="gd-section">
            <div className="dt-scroll">
              <table className="dt gd-matrix">
                <caption className="visually-hidden">{t('Permissions by role')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('Action')}</th>
                    {data.roles.map((r) => (
                      <th scope="col" key={r} className="gd-matrix-role">
                        {t(`role|${r}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.actions.map((a) => (
                    <tr key={a.action}>
                      <th scope="row">
                        <span>{label(a.action)}</span>
                        <div className="muted small mono">{a.action}</div>
                      </th>
                      {data.roles.map((r) => {
                        const ok = a.roles.includes(r);
                        return (
                          <td key={r} className={`gd-matrix-cell ${ok ? 'ok' : ''}`}>
                            <span aria-hidden="true">{ok ? '✓' : '—'}</span>
                            <span className="visually-hidden">{ok ? t('Allowed') : t('Not allowed')}</span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {general.data && !general.data.settings.require_mfa_for_privileged_roles ? (
              <p className="muted small">{t('Two-step verification is optional for every role in this organization. Each person can turn it on in Settings.')}</p>
            ) : general.data && cfg.data && cfg.data.mfa_required_roles.length > 0 ? (
              <p className="muted small">
                {t('Two-step verification is required for: {roles}', { roles: cfg.data.mfa_required_roles.map((r) => t(`role|${r}`)).join(locale === 'ja' ? '、' : ', ') })}
              </p>
            ) : null}
          </Card>
        )}
      </RouteStateBoundary>
    </>
  );
}
