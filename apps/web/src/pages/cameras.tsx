// web-14 Camera inventory. GET /v1/cameras?store_id= (scoped to the user's stores, ordered by name).
// Stream status = readiness reported by the edge; analysis status is separate: a camera record alone
// never means analysis is running.
import { useState } from 'react';
import { endpoints } from '../api/endpoints';
import { usePagedQuery } from '../api/hooks';
import type { Camera, CameraReadiness } from '../api/types';
import { DataTable, type Column } from '../components/DataTable';
import { AnalysisStatePill, ReadinessPill } from '../components/domain';
import { SelectField } from '../components/forms';
import { ChannelStatePill, DETECTION_CHANNELS, DETECTION_CHANNEL_LABEL, FreshnessPill } from '../components/groupb/ui';
import { PageHeader } from '../components/PageHeader';
import { ButtonLink, Notice } from '../components/primitives';
import { EmptyState } from '../components/states';
import { useI18n } from '../i18n';
import { screenPath } from '../routes.meta';
import { useSession } from '../session/SessionProvider';
import '../styles/group-b.css';

const READINESS_FILTERS: { value: '' | CameraReadiness; key: string }[] = [
  { value: '', key: 'Any stream status' },
  { value: 'ready', key: 'Ready' },
  { value: 'pending', key: 'readiness|Pending checks' },
  { value: 'degraded', key: 'readiness|Degraded' },
  { value: 'offline', key: 'readiness|Offline' },
  { value: 'disabled', key: 'readiness|Disabled' },
];

export default function CamerasPage() {
  const { t, fmt } = useI18n();
  const { stores, store, can } = useSession();
  const [storeFilter, setStoreFilter] = useState<string>(store?.id ?? '');
  const [readiness, setReadiness] = useState<'' | CameraReadiness>('');
  const q = usePagedQuery(
    (cursor, signal) => endpoints.cameras.list({ store_id: storeFilter || undefined, cursor }, { signal }),
    [storeFilter],
  );
  const tzOf = (c: Camera) => stores.find((s) => s.id === c.store_id)?.timezone ?? 'UTC';

  const columns: Column<Camera>[] = [
    {
      key: 'camera',
      header: t('Camera'),
      primary: true,
      render: (c) => (
        <span>
          <strong>{c.name}</strong>
          {c.location ? <span className="help">{c.location}</span> : null}
        </span>
      ),
    },
    { key: 'store', header: t('Store'), render: (c) => stores.find((s) => s.id === c.store_id)?.name ?? '—' },
    { key: 'stream', header: t('Stream status'), render: (c) => <ReadinessPill readiness={c.readiness} /> },
    { key: 'analysis', header: t('Analysis status'), render: (c) => <AnalysisStatePill state={c.analysis_state} /> },
    {
      key: 'channels',
      header: t('Detection channels'),
      render: (c) => (
        <ul className="plain-list gb-channel-list">
          {DETECTION_CHANNELS.map((ch) => (
            <li key={ch}>
              <span className="small">{t(DETECTION_CHANNEL_LABEL[ch])}</span> <ChannelStatePill value={c.channels?.[ch]} />
            </li>
          ))}
        </ul>
      ),
    },
    {
      key: 'last_frame',
      header: t('Last frame'),
      render: (c) => (
        <span>
          <FreshnessPill at={c.last_frame_at} />
          {c.last_frame_at ? <span className="help">{fmt.dateTime(c.last_frame_at, tzOf(c), { withZone: true })}</span> : null}
        </span>
      ),
    },
  ];

  const manage = can('camera.manage');
  return (
    <>
      <PageHeader
        screenId="web-14"
        subtitle={t('Cameras stay pending until the store edge verifies real decoded frames. Analysis starts only when you activate it.')}
        action={
          manage ? (
            <div className="page-actions">
              <ButtonLink to={screenPath('web-11')} variant="primary">
                {t('Discover cameras')}
              </ButtonLink>
              <ButtonLink to={screenPath('web-12')}>{t('Add manually')}</ButtonLink>
              <ButtonLink to={screenPath('web-13')}>{t('Import CSV')}</ButtonLink>
            </div>
          ) : undefined
        }
      />
      <div className="card">
        <DataTable
          caption={t('Camera inventory')}
          query={q}
          columns={columns}
          rowKey={(c) => c.id}
          rowHref={(c) => screenPath('web-15', { id: c.id })}
          filterRows={(c) => !readiness || c.readiness === readiness}
          toolbar={
            <>
              <SelectField
                label={t('Store')}
                value={storeFilter}
                onChange={(e) => setStoreFilter(e.target.value)}
                options={[{ value: '', label: t('All stores') }, ...stores.map((s) => ({ value: s.id, label: s.name }))]}
              />
              <SelectField
                label={t('Stream status')}
                value={readiness}
                onChange={(e) => setReadiness(e.target.value as '' | CameraReadiness)}
                options={READINESS_FILTERS.map((f) => ({ value: f.value, label: t(f.key) }))}
              />
            </>
          }
          empty={
            q.items.length > 0 ? (
              <EmptyState compact icon="search" title={t('No cameras match these filters')} />
            ) : (
              <EmptyState
                icon="cameras"
                title={t('No cameras added yet')}
                description={t('Discover ONVIF cameras through the store edge, add one by address, or import a CSV list.')}
                action={manage ? <ButtonLink to={screenPath('web-11')} variant="primary">{t('Discover cameras')}</ButtonLink> : undefined}
              />
            )
          }
        />
      </div>
      <Notice tone="info">{t('Stream status is reported by the store edge. A camera record by itself does not mean video is being analyzed.')}</Notice>
    </>
  );
}
