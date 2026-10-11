// web-25 Case management. GET /v1/cases?status= (server returns up to 200, newest update first;
// no cursor). Create case: POST /v1/cases {title, store_id} (case.manage).
import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { errorMessageKey, useApiQuery, useMutation } from '../api/hooks';
import { DataTable, type Column } from '../components/DataTable';
import { SelectField, TextField } from '../components/forms';
import { fieldError } from '../components/groupc/labels';
import { CaseStatusPill, useStoreName, useStoreTimeZone } from '../components/groupc/misc';
import { Modal } from '../components/Modal';
import { PageHeader } from '../components/PageHeader';
import { Button, FilterTabs } from '../components/primitives';
import { EmptyState, PermissionDenied } from '../components/states';
import { useI18n } from '../i18n';
import { screenPath } from '../routes.meta';
import { useSession } from '../session/SessionProvider';
import { gc, type CaseRecord } from './_groupc-api';
import '../styles/group-c.css';

type StatusTab = 'open' | 'closed' | 'all';

export default function CasesPage() {
  const { t, fmt } = useI18n();
  const { can } = useSession();
  const [params, setParams] = useSearchParams();
  const raw = params.get('status');
  const status: StatusTab = raw === 'closed' || raw === 'all' ? raw : 'open';
  const [createOpen, setCreateOpen] = useState(false);
  const tzFor = useStoreTimeZone();
  const storeName = useStoreName();
  const q = useApiQuery((signal) => gc.cases({ status: status === 'all' ? undefined : status }, { signal }), [status], {
    enabled: can('case.read'),
  });

  if (!can('case.read')) {
    return (
      <>
        <PageHeader screenId="web-25" />
        <PermissionDenied permission="case.read" />
      </>
    );
  }

  const columns: Column<CaseRecord>[] = [
    {
      key: 'case',
      header: t('Case'),
      primary: true,
      render: (c) => (
        <span>
          <span className="mono-ish">{c.ref}</span> · {c.title}
        </span>
      ),
    },
    { key: 'store', header: t('Store'), render: (c) => storeName(c.store_id) },
    { key: 'owner', header: t('Owner'), render: (c) => c.owner?.display_name || <span className="muted">{t('Unassigned')}</span> },
    { key: 'incidents', header: t('Incidents'), align: 'end', render: (c) => fmt.number(c.incident_count ?? 0) },
    { key: 'status', header: t('Status'), render: (c) => <CaseStatusPill status={c.status} /> },
    {
      key: 'updated',
      header: t('Last updated'),
      render: (c) => (c.updated_at ? fmt.dateTime(c.updated_at, tzFor(c.store_id), { withZone: true, seconds: false }) : '—'),
    },
  ];

  return (
    <>
      <PageHeader
        screenId="web-25"
        action={
          can('case.manage') ? (
            <Button icon="cases" onClick={() => setCreateOpen(true)}>
              {t('Create case')}
            </Button>
          ) : undefined
        }
      />
      <div className="card">
        <DataTable
          caption={t('Cases')}
          rows={q.data?.items ?? []}
          loading={q.loading}
          error={q.error}
          onRetry={q.reload}
          columns={columns}
          rowKey={(c) => c.id}
          rowHref={(c) => screenPath('web-26', { id: c.id })}
          toolbar={
            <FilterTabs<StatusTab>
              label={t('Status')}
              value={status}
              onChange={(v) => {
                const next = new URLSearchParams(params);
                if (v === 'open') next.delete('status');
                else next.set('status', v);
                setParams(next, { replace: true });
              }}
              items={[
                { value: 'open', label: t('case|Open') },
                { value: 'closed', label: t('case|Closed') },
                { value: 'all', label: t('All cases') },
              ]}
            />
          }
          empty={
            <EmptyState
              icon="cases"
              title={status === 'closed' ? t('No closed cases') : status === 'open' ? t('No open cases') : t('No cases yet')}
              description={t('Create a case from an incident workspace to group related incidents, notes and evidence exports.')}
            />
          }
        />
        <p className="muted small">{t('Showing up to 200 most recently updated cases.')}</p>
      </div>
      <CreateCaseModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </>
  );
}

function CreateCaseModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { stores, store, me } = useSession();
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [storeId, setStoreId] = useState(store?.id ?? '');
  const [touched, setTouched] = useState(false);
  const orgWide = me?.user.role === 'org_admin';
  const m = useMutation(() => gc.createCase({ title: title.trim(), ...(storeId ? { store_id: storeId } : {}) }), {
    successMessage: t('Case created'),
    onSuccess: (c) => navigate(screenPath('web-26', { id: c.id })),
    onError: (e) => e.status === 422,
  });
  const errors = {
    title: title.trim().length === 0 ? t('Enter a case title.') : null,
    store: !storeId && !orgWide ? t('Select a store.') : null,
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!errors.title && !errors.store) await m.run(undefined);
  };
  return (
    <Modal open={open} onClose={onClose} title={t('Create case')} size="sm" dismissible={!m.pending}>
      <form onSubmit={submit} noValidate>
        <TextField
          label={t('Case title')}
          required
          maxLength={200}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          error={(touched ? errors.title : null) ?? fieldError(t, m.fieldErrors.title)}
        />
        <SelectField
          label={t('Store')}
          required={!orgWide}
          value={storeId}
          onChange={(e) => setStoreId(e.target.value)}
          placeholder={orgWide ? t('All stores (organization-wide)') : t('Select a store')}
          options={stores.map((s) => ({ value: s.id, label: s.name }))}
          hint={t('Only incidents from this store can be linked.')}
          error={(touched ? errors.store : null) ?? fieldError(t, m.fieldErrors.store_id)}
        />
        {m.error && m.error.status !== 422 ? (
          <div className="field-error" role="alert">
            {t(errorMessageKey(m.error))}
          </div>
        ) : null}
        <div className="modal-foot">
          <Button variant="secondary" onClick={onClose} disabled={m.pending}>
            {t('Cancel')}
          </Button>
          <Button type="submit" pending={m.pending}>
            {t('Create case')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
