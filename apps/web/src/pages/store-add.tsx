// web-07 Add a store. POST /v1/stores {name, region, address, timezone, manager_name, opening_hours}
// (the API requires org.manage). 422 duplicate name / unknown timezone are shown inline.
// The draft stays on screen after a failure so a retry never needs re-typing; double submits are ignored.
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import type { ApiError } from '../api/client';
import { endpoints } from '../api/endpoints';
import { useMutation } from '../api/hooks';
import { fieldErrorText } from '../components/forms';
import { EMPTY_STORE, StoreFields, trimStore, validateStore, type StoreDraft, type StoreErrors } from '../components/groupb/StoreFields';
import { ReviewCard, Unset } from '../components/groupb/ui';
import { PageHeader } from '../components/PageHeader';
import { Button, ButtonLink, Card, Notice } from '../components/primitives';
import { PermissionDenied } from '../components/states';
import { useI18n } from '../i18n';
import { screenPath } from '../routes.meta';
import { useSession } from '../session/SessionProvider';
import '../styles/group-b.css';

export default function StoreAddPage() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const { can, me, reload: reloadSession, setStoreId } = useSession();
  const [draft, setDraft] = useState<StoreDraft>({ ...EMPTY_STORE, timezone: me?.org.timezone ?? EMPTY_STORE.timezone });
  const [errors, setErrors] = useState<StoreErrors>({});

  const create = useMutation((body: StoreDraft) => endpoints.stores.create(body), {
    successMessage: t('Store added'),
    onSuccess: (s) => {
      reloadSession();
      setStoreId(s.id);
      navigate(screenPath('web-06', { id: s.id }));
    },
    onError: (e: ApiError) => {
      if (e.status === 422) {
        setErrors(Object.fromEntries(Object.entries(e.fieldErrors).map(([k, v]) => [k, fieldErrorText(v, locale)])));
        return true;
      }
      return false;
    },
  });

  if (!can('org.manage')) {
    return (
      <>
        <PageHeader screenId="web-07" />
        <PermissionDenied permission="org.manage" />
      </>
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs = validateStore(draft, t);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    void create.run(trimStore(draft));
  };

  return (
    <>
      <PageHeader screenId="web-07" subtitle={t('Create the store record first. Pair its edge appliance and add cameras next.')} />
      <div className="grid gb-form-layout">
        <Card title={t('Add a store')}>
          <form onSubmit={submit} noValidate>
            <StoreFields
              draft={draft}
              errors={errors}
              onChange={(k, v) => {
                setDraft((d) => ({ ...d, [k]: v }));
                setErrors((x) => ({ ...x, [k]: null }));
              }}
            />
            <div className="action-row">
              <Button type="submit" pending={create.pending}>
                {t('Save')}
              </Button>
              <ButtonLink to={screenPath('web-05')}>{t('Cancel')}</ButtonLink>
            </div>
          </form>
        </Card>
        <ReviewCard
          items={[
            { label: t('Store name'), value: draft.name.trim() || <Unset /> },
            { label: t('Address'), value: draft.address.trim() || <Unset /> },
            { label: t('Timezone'), value: draft.timezone || <Unset /> },
            { label: t('Store manager'), value: draft.manager_name.trim() || <Unset /> },
            { label: t('Opening hours'), value: draft.opening_hours.trim() || <Unset /> },
          ]}
        >
          <Notice tone="info">{t('A new store has no cameras and no edge appliance. Nothing is monitored until an edge is paired and cameras pass readiness checks.')}</Notice>
        </ReviewCard>
      </div>
    </>
  );
}
