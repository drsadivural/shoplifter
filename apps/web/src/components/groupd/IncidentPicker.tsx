// Supporting-incident picker for watchlist enrollment. Searches only incidents that a person
// reviewed as confirmed (GET /v1/incidents?outcome=confirmed&q=...). Unreviewed detections and
// alerts can never be used as an enrollment basis.
import { useId, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router';
import type { ApiError } from '../../api/client';
import { endpoints } from '../../api/endpoints';
import { toApiError } from '../../api/hooks';
import type { IncidentSummary } from '../../api/types';
import { useI18n } from '../../i18n';
import { screenPath } from '../../routes.meta';
import { useSession } from '../../session/SessionProvider';
import { ChannelLabel, OutcomePill } from '../domain';
import { TextInput } from '../forms';
import { Button, Notice } from '../primitives';
import { ErrorState } from '../states';

export interface PickedIncident {
  id: string;
  ref: string;
  outcome: IncidentSummary['outcome'];
  store_name?: string;
  captured_at?: string;
  store_timezone?: string;
}

export function IncidentPicker({
  value,
  onChange,
  error,
}: {
  value: PickedIncident | null;
  onChange: (v: PickedIncident | null) => void;
  error?: string | null;
}) {
  const { t, fmt } = useI18n();
  const { can, timeZone } = useSession();
  const id = useId();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<IncidentSummary[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<ApiError | null>(null);

  const search = async () => {
    setSearching(true);
    setSearchError(null);
    try {
      const page = await endpoints.incidents.list({ q: q.trim() || undefined, outcome: 'confirmed', limit: 10 });
      setResults(page.items);
    } catch (e) {
      setSearchError(toApiError(e));
      setResults(null);
    } finally {
      setSearching(false);
    }
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void search();
    }
  };

  const label = (
    <span>
      {t('Supporting incident')}
      <span className="required-marker" aria-hidden="true">
        {' '}
        *
      </span>
      <span className="visually-hidden"> ({t('required')})</span>
    </span>
  );

  if (!can('incident.read')) {
    return (
      <div className="field">
        <div className="gd-label">{label}</div>
        <Notice tone="warning">{t('You need access to incidents to choose the supporting incident. Ask an investigator or store admin.')}</Notice>
      </div>
    );
  }

  return (
    <div className={`field gd-picker ${error ? 'field-invalid' : ''}`} role="group" aria-labelledby={`${id}-l`}>
      <div className="gd-label" id={`${id}-l`}>
        {label}
      </div>
      {value ? (
        <div className="gd-picked">
          <div>
            <Link to={screenPath('web-24', { id: value.id })} className="mono-ish">
              {value.ref}
            </Link>{' '}
            <OutcomePill outcome={value.outcome} />
            {value.store_name ? <div className="muted small">{value.store_name}{value.captured_at ? ` · ${fmt.dateTime(value.captured_at, value.store_timezone ?? timeZone, { withZone: true })}` : ''}</div> : null}
          </div>
          <Button size="sm" variant="secondary" onClick={() => onChange(null)}>
            {t('Change')}
          </Button>
        </div>
      ) : (
        <>
          <div className="gd-picker-search">
            <TextInput
              aria-label={t('Search confirmed incidents by reference or description')}
              placeholder="INC-2026-000001"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onKey}
              aria-invalid={error ? true : undefined}
            />
            <Button variant="secondary" icon="search" onClick={() => void search()} pending={searching}>
              {t('Search')}
            </Button>
          </div>
          {searchError ? <ErrorState compact error={searchError} onRetry={() => void search()} /> : null}
          {results !== null && results.length === 0 ? (
            <p className="muted small" role="status">
              {t('No confirmed incidents match. Only incidents a person reviewed as confirmed can support an enrollment.')}
            </p>
          ) : null}
          {results && results.length > 0 ? (
            <ul className="rows gd-picker-results" aria-label={t('Confirmed incidents')}>
              {results.map((r) => (
                <li className="row" key={r.id}>
                  <div className="row-main">
                    <strong className="mono-ish">{r.ref}</strong> <OutcomePill outcome={r.outcome} />
                    <div className="muted small">
                      <ChannelLabel channel={r.channel} /> · {r.store_name} · {fmt.dateTime(r.captured_at, r.store_timezone ?? timeZone, { withZone: true })}
                    </div>
                    {r.description ? <div className="small gd-clamp">{r.description}</div> : null}
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      onChange({ id: r.id, ref: r.ref, outcome: r.outcome, store_name: r.store_name, captured_at: r.captured_at, store_timezone: r.store_timezone })
                    }
                    aria-label={t('Use {ref}', { ref: r.ref })}
                  >
                    {t('Use')}
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
      <div className="help">{t('Approval requires an incident that a person reviewed and recorded as a confirmed incident. Alerts and unreviewed detections cannot be used.')}</div>
      {error ? (
        <div className="field-error">
          <span aria-hidden="true">▲ </span>
          {error}
        </div>
      ) : null}
    </div>
  );
}
