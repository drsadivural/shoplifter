// web-04 Organization setup. GET /v1/org, PATCH /v1/org {expected_version, name?, timezone?, region?, primary_admin_id?}.
// Primary administrator = one of the active organization admins from GET /v1/users (user.manage).
// 409 -> ConflictBanner (draft kept until the user reloads); 422 -> inline field errors.
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { ApiError } from '../api/client';
import { endpoints } from '../api/endpoints';
import { useApiQuery, useMutation } from '../api/hooks';
import type { Org, User } from '../api/types';
import { TIMEZONES } from '../components/groupb/api';
import { ReviewCard, Unset } from '../components/groupb/ui';
import { SelectField, TextField, fieldErrorText } from '../components/forms';
import { PageHeader } from '../components/PageHeader';
import { Button, Card, Notice } from '../components/primitives';
import { RouteStateBoundary } from '../components/RouteStateBoundary';
import { ConflictBanner } from '../components/states';
import { useI18n } from '../i18n';
import { useSession } from '../session/SessionProvider';
import '../styles/group-b.css';

interface Draft {
  name: string;
  timezone: string;
  region: string;
  primary_admin_id: string;
}

const toDraft = (o: Org): Draft => ({ name: o.name, timezone: o.timezone, region: o.region, primary_admin_id: o.primary_admin_id });

export default function OrganizationPage() {
  const q = useApiQuery((signal) => endpoints.org.get({ signal }), []);
  return (
    <>
      <PageHeader screenId="web-04" />
      <RouteStateBoundary query={q} permission="org.manage">
        {(org) => <OrgForm org={org} onSaved={(o) => q.setData(o)} reload={q.reload} reloading={q.fetching} />}
      </RouteStateBoundary>
    </>
  );
}

function OrgForm({ org, onSaved, reload, reloading }: { org: Org; onSaved: (o: Org) => void; reload: () => void; reloading: boolean }) {
  const { t, locale } = useI18n();
  const { can, reload: reloadSession } = useSession();
  const [draft, setDraft] = useState<Draft>(() => toDraft(org));
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>({});
  const [conflict, setConflict] = useState<number | null>(null);
  // Load the server copy into the form when a different version arrives and the user has no draft edits.
  const [base, setBase] = useState(org.version);
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(org));
  useEffect(() => {
    if (org.version !== base && conflict === null) {
      setDraft(toDraft(org));
      setBase(org.version);
    }
  }, [org, base, conflict]);

  const users = useApiQuery((signal) => endpoints.users.list({}, { signal }), [], { enabled: can('user.manage') });
  const admins = useMemo(
    () => (users.data?.items ?? []).filter((u: User) => u.role === 'org_admin' && u.active),
    [users.data],
  );

  const save = useMutation(
    (body: Partial<Draft> & { expected_version: number }) => endpoints.org.update(body),
    {
      successMessage: t('Organization settings saved'),
      onSuccess: (o) => {
        onSaved(o);
        setDraft(toDraft(o));
        setBase(o.version);
        setConflict(null);
        reloadSession();
      },
      onError: (e: ApiError) => {
        if (e.status === 409) {
          setConflict(e.currentVersion);
          reload();
          return true;
        }
        if (e.status === 422) {
          setErrors(Object.fromEntries(Object.entries(e.fieldErrors).map(([k, v]) => [k, fieldErrorText(v, locale) ?? ''])));
          return true;
        }
        return false;
      },
    },
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: Partial<Record<keyof Draft, string>> = {};
    if (!draft.name.trim()) next.name = t('field_error|required');
    if (!draft.timezone) next.timezone = t('field_error|required');
    if (!draft.region.trim()) next.region = t('field_error|required');
    if (!draft.primary_admin_id) next.primary_admin_id = t('field_error|required');
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    const current = toDraft(org);
    const body: Partial<Draft> & { expected_version: number } = { expected_version: org.version };
    (Object.keys(draft) as (keyof Draft)[]).forEach((k) => {
      const v = k === 'name' || k === 'region' ? draft[k].trim() : draft[k];
      if (v !== current[k]) body[k] = v;
    });
    if (Object.keys(body).length === 1) {
      setErrors({});
      return;
    }
    void save.run(body);
  };

  const set = (k: keyof Draft) => (v: string) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const tzOptions = Array.from(new Set([org.timezone, ...TIMEZONES])).map((z) => ({ value: z, label: z }));
  const adminOptions = admins.map((u) => ({ value: u.id, label: `${u.display_name} · ${u.email}` }));
  const adminKnown = admins.some((u) => u.id === draft.primary_admin_id);
  const adminLabel = admins.find((u) => u.id === draft.primary_admin_id)?.display_name;

  return (
    <>
      {conflict !== null ? (
        <ConflictBanner
          currentVersion={org.version}
          reloading={reloading}
          onReload={() => {
            setDraft(toDraft(org));
            setBase(org.version);
            setConflict(null);
            reload();
          }}
        />
      ) : null}
      <div className="grid gb-form-layout">
        <Card title={t('Organization setup')}>
          <form onSubmit={submit} noValidate>
            <div className="form-grid">
              <TextField
                label={t('Organization name')}
                required
                maxLength={200}
                value={draft.name}
                onChange={(e) => set('name')(e.target.value)}
                error={errors.name}
                autoComplete="organization"
              />
              <SelectField
                label={t('Default timezone')}
                required
                value={draft.timezone}
                onChange={(e) => set('timezone')(e.target.value)}
                options={tzOptions}
                error={errors.timezone}
                hint={t('Used for organization-wide reports. Each store keeps its own timezone.')}
              />
              <TextField
                label={t('Data region')}
                required
                maxLength={100}
                value={draft.region}
                onChange={(e) => set('region')(e.target.value)}
                error={errors.region}
                hint={t('Where records for this organization are stored. Changing it does not move existing data.')}
              />
              {users.error ? (
                <div className="field">
                  <span className="gb-label">{t('Primary administrator')}</span>
                  <p className="muted small">{t('The administrator list could not be loaded, so the primary administrator cannot be changed here.')}</p>
                </div>
              ) : (
                <SelectField
                  label={t('Primary administrator')}
                  required
                  value={draft.primary_admin_id}
                  onChange={(e) => set('primary_admin_id')(e.target.value)}
                  options={adminKnown || !draft.primary_admin_id ? adminOptions : [...adminOptions, { value: draft.primary_admin_id, label: t('Current administrator (inactive or not an organization admin)') }]}
                  placeholder={users.loading ? t('Loading…') : t('Select an organization admin')}
                  error={errors.primary_admin_id}
                  hint={t('Only active organization admins can be selected.')}
                />
              )}
            </div>
            <div className="action-row">
              <Button type="submit" pending={save.pending}>
                {t('Save')}
              </Button>
              {dirty ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setDraft(toDraft(org));
                    setErrors({});
                  }}
                >
                  {t('Cancel')}
                </Button>
              ) : null}
            </div>
            <p className="muted small">{t('Version {n}', { n: org.version })}</p>
          </form>
        </Card>
        <ReviewCard
          items={[
            { label: t('Organization name'), value: draft.name.trim() || <Unset /> },
            { label: t('Default timezone'), value: draft.timezone || <Unset /> },
            { label: t('Data region'), value: draft.region.trim() || <Unset /> },
            { label: t('Primary administrator'), value: adminLabel ?? <Unset /> },
          ]}
        >
          <Notice tone="info">{t('Store timezones are set per store. Alerts and records are always shown in the store’s own timezone.')}</Notice>
        </ReviewCard>
      </div>
    </>
  );
}
