// web-05 Stores & regions. GET /v1/stores (scoped to the user's stores; the API returns one page
// ordered by name). Search and region filters apply to the loaded rows (the API has no filter params).
import { useMemo, useState } from 'react';
import { endpoints } from '../api/endpoints';
import { usePagedQuery } from '../api/hooks';
import type { Store } from '../api/types';
import { DataTable, type Column } from '../components/DataTable';
import { EdgeStatePill } from '../components/domain';
import { SelectField, TextField } from '../components/forms';
import { PageHeader } from '../components/PageHeader';
import { ButtonLink, StatusPill } from '../components/primitives';
import { EmptyState, PermissionDenied } from '../components/states';
import { useI18n } from '../i18n';
import { screenPath } from '../routes.meta';
import { useSession } from '../session/SessionProvider';
import '../styles/group-b.css';

export default function StoresPage() {
  const { t, fmt } = useI18n();
  const { can } = useSession();
  const [query, setQuery] = useState('');
  const [region, setRegion] = useState('');
  const q = usePagedQuery((cursor, signal) => endpoints.stores.list({ cursor }, { signal }), [], { enabled: can('store.read') });
  const regions = useMemo(() => Array.from(new Set(q.items.map((s) => s.region).filter(Boolean))).sort(), [q.items]);

  const columns: Column<Store>[] = [
    {
      key: 'name',
      header: t('Store'),
      primary: true,
      render: (s) => (
        <span>
          <strong>{s.name}</strong>
          <span className="help">{s.address}</span>
        </span>
      ),
    },
    { key: 'region', header: t('Region'), render: (s) => s.region || <span className="muted">{t('Not set')}</span> },
    {
      key: 'cameras',
      header: t('Cameras'),
      render: (s) =>
        s.camera_count === 0 ? (
          <span className="muted">{t('No cameras')}</span>
        ) : (
          t('{ready} of {total} ready', { ready: fmt.number(s.cameras_ready), total: fmt.number(s.camera_count) })
        ),
    },
    {
      key: 'health',
      header: t('Health'),
      render: (s) => (
        <span className="gb-inline">
          <EdgeStatePill state={s.edge_state} />
          {s.camera_count > 0 && s.cameras_ready < s.camera_count ? (
            <StatusPill tone="warning">{t('{n} cameras not ready', { n: s.camera_count - s.cameras_ready })}</StatusPill>
          ) : null}
        </span>
      ),
    },
    { key: 'open_alerts', header: t('Open alerts'), align: 'end', render: (s) => fmt.number(s.open_alerts) },
  ];

  const needle = query.trim().toLowerCase();
  const filter = (s: Store) =>
    (!region || s.region === region) &&
    (!needle || [s.name, s.address, s.region, s.manager_name].some((v) => v?.toLowerCase().includes(needle)));

  return (
    <>
      <PageHeader
        screenId="web-05"
        subtitle={t('Stores you can access, with camera readiness and edge connectivity.')}
        action={can('org.manage') ? <ButtonLink to={screenPath('web-07')} variant="primary">{t('Add a store')}</ButtonLink> : undefined}
      />
      {!can('store.read') ? (
        <PermissionDenied permission="store.read" />
      ) : (
        <div className="card">
          <DataTable
            caption={t('Stores & regions')}
            query={q}
            columns={columns}
            rowKey={(s) => s.id}
            rowHref={(s) => screenPath('web-06', { id: s.id })}
            filterRows={filter}
            toolbar={
              <>
                <TextField
                  label={t('Search stores')}
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('Name, address or manager')}
                />
                {regions.length > 1 ? (
                  <SelectField
                    label={t('Region')}
                    value={region}
                    onChange={(e) => setRegion(e.target.value)}
                    options={[{ value: '', label: t('All regions') }, ...regions.map((r) => ({ value: r, label: r }))]}
                  />
                ) : null}
              </>
            }
            empty={
              q.items.length > 0 ? (
                <EmptyState compact icon="search" title={t('No stores match this search')} />
              ) : (
                <EmptyState
                  icon="info"
                  title={t('No stores yet')}
                  description={t('Add your first store, then pair its edge appliance and cameras.')}
                  action={can('org.manage') ? <ButtonLink to={screenPath('web-07')} variant="primary">{t('Add a store')}</ButtonLink> : undefined}
                />
              )
            }
          />
        </div>
      )}
    </>
  );
}
