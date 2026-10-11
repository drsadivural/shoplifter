// web-06 Store detail (`?id=`). GET /v1/stores/{id} (summary: coverage, open incidents, review
// queue, last_refresh), GET /v1/cameras?store_id=, GET /v1/edges?store_id=.
// Edit: PATCH /v1/stores/{id} {expected_version, ...changed fields}; 409 -> ConflictBanner + reload.
import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { ApiError } from '../api/client';
import { endpoints } from '../api/endpoints';
import { useApiQuery, useMutation } from '../api/hooks';
import type { StoreDetail } from '../api/types';
import { AnalysisStatePill, EdgeStatePill, ReadinessPill } from '../components/domain';
import { fieldErrorText } from '../components/forms';
import { gb } from '../components/groupb/api';
import { StoreFields, trimStore, validateStore, type StoreDraft, type StoreErrors } from '../components/groupb/StoreFields';
import { FreshnessPill } from '../components/groupb/ui';
import { Modal } from '../components/Modal';
import { PageHeader } from '../components/PageHeader';
import { Button, ButtonLink, Card, KeyValueList, StatCard, StatusPill } from '../components/primitives';
import { RouteStateBoundary } from '../components/RouteStateBoundary';
import { ConflictBanner, EmptyState, ErrorState, LoadingState } from '../components/states';
import { useI18n } from '../i18n';
import { screenPath } from '../routes.meta';
import { useSession } from '../session/SessionProvider';
import '../styles/group-b.css';

const toDraft = (s: StoreDetail): StoreDraft => ({
  name: s.name,
  region: s.region,
  address: s.address,
  timezone: s.timezone,
  manager_name: s.manager_name,
  opening_hours: s.opening_hours,
});

export default function StoreDetailPage() {
  const { t, fmt } = useI18n();
  const [params] = useSearchParams();
  const id = params.get('id');
  const { can } = useSession();
  const q = useApiQuery((signal) => endpoints.stores.get(id!, { signal }), [id], { enabled: Boolean(id), pollMs: 60_000 });
  const [editing, setEditing] = useState(false);
  const [conflict, setConflict] = useState(false);
  const store = q.data;

  if (!id) {
    return (
      <>
        <PageHeader screenId="web-06" />
        <EmptyState
          icon="info"
          title={t('No store selected')}
          description={t('Open a store from the store list.')}
          action={<ButtonLink to={screenPath('web-05')}>{t('Open store list')}</ButtonLink>}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        screenId="web-06"
        title={store?.name}
        subtitle={store ? `${store.address} · ${store.timezone}` : undefined}
        action={
          store ? (
            <div className="page-action-stack">
              <div className="page-actions">
                <Button variant="secondary" icon="refresh" onClick={q.reload} pending={q.fetching}>
                  {t('Refresh')}
                </Button>
                {can('store.manage') ? (
                  <Button variant="secondary" onClick={() => setEditing(true)}>
                    {t('Edit store')}
                  </Button>
                ) : null}
              </div>
              <span className="muted small">
                {t('Last refresh')}: {fmt.time(store.summary.last_refresh, store.timezone, { seconds: true, withZone: true })}
              </span>
            </div>
          ) : undefined
        }
      />
      {conflict ? (
        <ConflictBanner
          currentVersion={store?.version}
          reloading={q.fetching}
          onReload={() => {
            setConflict(false);
            q.reload();
          }}
        />
      ) : null}
      <RouteStateBoundary query={q} permission="store.read">
        {(data) => <StoreReady store={data} />}
      </RouteStateBoundary>
      {store ? (
        <EditStoreDialog
          open={editing}
          store={store}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            q.reload();
          }}
          onConflict={() => {
            setEditing(false);
            setConflict(true);
            q.reload();
          }}
        />
      ) : null}
    </>
  );
}

function StoreReady({ store }: { store: StoreDetail }) {
  const { t, fmt } = useI18n();
  const { can } = useSession();
  const s = store.summary;
  const cov = s.coverage;
  return (
    <>
      <div className="stats">
        <StatCard
          label={t('Coverage')}
          value={cov.cameras_total === 0 ? fmt.number(0) : `${fmt.number(cov.cameras_analyzing)}/${fmt.number(cov.cameras_total)}`}
          caption={cov.cameras_total === 0 ? t('No cameras added yet') : t('Cameras analyzing · current')}
          to={screenPath('web-14')}
        />
        <StatCard
          label={t('Camera health')}
          value={cov.cameras_total === 0 ? fmt.number(0) : `${fmt.number(cov.cameras_ready)}/${fmt.number(cov.cameras_total)}`}
          caption={t('Ready cameras · reported by store edge')}
          to={screenPath('web-14')}
        />
        <StatCard label={t('Open incidents')} value={fmt.number(s.open_incidents)} caption={t('Unresolved · this store')} to="/web/alerts" />
        <StatCard label={t('Review queue')} value={fmt.number(s.review_queue)} caption={t('Awaiting review or review requested')} to="/web/alerts?status=new,reviewing" />
      </div>
      <div className="grid gb-form-layout">
        <Card title={t('Store profile')}>
          <KeyValueList
            items={[
              { label: t('Store name'), value: store.name },
              { label: t('Region'), value: store.region || <span className="muted">{t('Not set')}</span> },
              { label: t('Address'), value: store.address },
              { label: t('Timezone'), value: store.timezone },
              { label: t('Store manager'), value: store.manager_name || <span className="muted">{t('Not set')}</span> },
              { label: t('Opening hours'), value: store.opening_hours || <span className="muted">{t('Not set')}</span> },
            ]}
          />
          <p className="muted small">{t('Version {n}', { n: store.version })}</p>
          <div className="action-row">
            {can('policy.manage') ? (
              <>
                <ButtonLink size="sm" to={screenPath('web-17', { store_id: store.id })}>
                  {t('Behavior detection rules')}
                </ButtonLink>
                <ButtonLink size="sm" to={screenPath('web-18', { store_id: store.id })}>
                  {t('Store calibration')}
                </ButtonLink>
              </>
            ) : null}
          </div>
        </Card>
        <EdgesCard store={store} />
        <CamerasCard store={store} />
      </div>
    </>
  );
}

function EdgesCard({ store }: { store: StoreDetail }) {
  const { t, fmt } = useI18n();
  const { can } = useSession();
  const q = useApiQuery((signal) => gb.edges(store.id, { signal }), [store.id]);
  const edges = (q.data?.items ?? []).filter((e) => e.state !== 'revoked');
  return (
    <Card
      title={t('Edge appliances')}
      titleAddon={<EdgeStatePill state={store.edge_state} />}
      actions={
        can('edge.manage') ? (
          <Link className="link-sm" to={screenPath('web-08', { store_id: store.id })}>
            {t('Connect edge appliance')}
          </Link>
        ) : undefined
      }
    >
      {q.error && !q.data ? (
        <ErrorState compact error={q.error} onRetry={q.reload} />
      ) : !q.data ? (
        <LoadingState variant="inline" />
      ) : edges.length === 0 ? (
        <EmptyState
          compact
          icon="wifiOff"
          title={t('No edge appliance paired')}
          description={t('Discovery, live view and analysis need a paired edge appliance at the store.')}
        />
      ) : (
        <ul className="rows">
          {edges.map((e) => (
            <li className="row" key={e.id}>
              <div className="row-main">
                <strong>{e.name}</strong>
                <div className="help">
                  {t('Last seen')}: {e.last_seen_at ? fmt.dateTime(e.last_seen_at, store.timezone, { withZone: true }) : t('never')} ·{' '}
                  {t('Software')} {e.software_version || '—'}
                </div>
              </div>
              <StatusPill tone={e.state === 'online' ? 'ok' : 'critical'}>{t(e.state === 'online' ? 'edge|Online' : 'edge|Offline')}</StatusPill>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function CamerasCard({ store }: { store: StoreDetail }) {
  const { t } = useI18n();
  const { can } = useSession();
  const q = useApiQuery((signal) => endpoints.cameras.list({ store_id: store.id }, { signal }), [store.id], { enabled: can('camera.read') });
  if (!can('camera.read')) return null;
  return (
    <Card
      title={t('Camera health')}
      actions={
        <Link className="link-sm" to={screenPath('web-14')}>
          {t('Camera inventory')}
        </Link>
      }
    >
      {q.error && !q.data ? (
        <ErrorState compact error={q.error} onRetry={q.reload} />
      ) : !q.data ? (
        <LoadingState variant="inline" />
      ) : q.data.items.length === 0 ? (
        <EmptyState
          compact
          icon="cameras"
          title={t('No cameras added yet')}
          description={t('Add cameras from the camera inventory. They stay pending until real frames are verified.')}
        />
      ) : (
        <ul className="rows">
          {q.data.items.map((c) => (
            <li className="row" key={c.id}>
              <div className="row-main">
                <Link to={screenPath('web-15', { id: c.id })} className="row-title-plain">
                  {c.name}
                  {c.location ? ` · ${c.location}` : ''}
                </Link>
                <div className="help">
                  <FreshnessPill at={c.last_frame_at} />
                </div>
              </div>
              <ReadinessPill readiness={c.readiness} />
              <AnalysisStatePill state={c.analysis_state} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function EditStoreDialog({
  open,
  store,
  onClose,
  onSaved,
  onConflict,
}: {
  open: boolean;
  store: StoreDetail;
  onClose: () => void;
  onSaved: () => void;
  onConflict: () => void;
}) {
  const { t, locale } = useI18n();
  const { reload: reloadSession } = useSession();
  const [draft, setDraft] = useState<StoreDraft>(() => toDraft(store));
  const [errors, setErrors] = useState<StoreErrors>({});
  const [openedFor, setOpenedFor] = useState<number | null>(null);
  if (open && openedFor !== store.version) {
    setOpenedFor(store.version);
    setDraft(toDraft(store));
    setErrors({});
  }
  if (!open && openedFor !== null) setOpenedFor(null);

  const save = useMutation((body: Partial<StoreDraft> & { expected_version: number }) => endpoints.stores.update(store.id, body), {
    successMessage: t('Store saved'),
    onSuccess: () => {
      reloadSession();
      onSaved();
    },
    onError: (e: ApiError) => {
      if (e.status === 409) {
        onConflict();
        return true;
      }
      if (e.status === 422) {
        setErrors(Object.fromEntries(Object.entries(e.fieldErrors).map(([k, v]) => [k, fieldErrorText(v, locale)])));
        return true;
      }
      return false;
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs = validateStore(draft, t);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const clean = trimStore(draft);
    const cur = toDraft(store);
    const body: Partial<StoreDraft> & { expected_version: number } = { expected_version: store.version };
    (Object.keys(clean) as (keyof StoreDraft)[]).forEach((k) => {
      if (clean[k] !== cur[k]) body[k] = clean[k];
    });
    if (Object.keys(body).length === 1) {
      onClose();
      return;
    }
    void save.run(body);
  };

  return (
    <Modal open={open} onClose={onClose} title={t('Edit store')} dismissible={!save.pending} size="lg">
      <form onSubmit={submit} noValidate>
        <StoreFields
          draft={draft}
          errors={errors}
          onChange={(k, v) => {
            setDraft((d) => ({ ...d, [k]: v }));
            setErrors((x) => ({ ...x, [k]: null }));
          }}
        />
        <div className="modal-foot">
          <Button variant="secondary" onClick={onClose} disabled={save.pending}>
            {t('Cancel')}
          </Button>
          <Button type="submit" pending={save.pending}>
            {t('Save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
