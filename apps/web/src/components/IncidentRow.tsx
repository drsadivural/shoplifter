// Compact incident row (dashboard "Alerts awaiting review", empty/error screens).
import { Link } from 'react-router';
import type { IncidentSummary } from '../api/types';
import { useI18n } from '../i18n';
import { screenPath } from '../routes.meta';
import { useSession } from '../session/SessionProvider';
import { ChannelLabel, IncidentStatusPill } from './domain';
import { Icon } from './Icon';

export function IncidentRow({ incident }: { incident: IncidentSummary }) {
  const { t, fmt } = useI18n();
  const { stores, timeZone } = useSession();
  const tz = incident.store_timezone ?? stores.find((s) => s.id === incident.store_id)?.timezone ?? timeZone;
  return (
    <li className="row">
      <span className={`channel-icon channel-${incident.channel}`} aria-hidden="true">
        <Icon name={incident.channel === 'watchlist_candidate' ? 'watchlist' : incident.channel === 'checkout_exception' ? 'reports' : 'alerts'} />
      </span>
      <div className="row-main">
        <Link to={screenPath('web-20', { id: incident.id })} className="row-title">
          {incident.ref}
        </Link>
        <div className="help">
          <ChannelLabel channel={incident.channel} /> · {incident.camera_name ?? t('No camera')} · {fmt.time(incident.captured_at, tz)}
          {incident.delayed ? ` · ${t('Delayed delivery')}` : ''}
        </div>
      </div>
      <IncidentStatusPill status={incident.status} />
      <Icon name="chevronRight" className="muted" />
    </li>
  );
}

