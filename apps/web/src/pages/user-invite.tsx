// web-44 Invite a teammate. POST /v1/users/invitations {email, role, store_ids, expires_in_days}
// -> {accept_url, expires_at}. The accept URL is shown once (copy button); email delivery is not
// configured, so it must be delivered through an approved channel. 409 account_exists inline.
import '../styles/group-d.css';
import { useState, type FormEvent } from 'react';
import { endpoints } from '../api/endpoints';
import { useMutation } from '../api/hooks';
import type { Role } from '../api/types';
import { apiErrorText, fieldMessage } from '../components/groupd/errors';
import { OnceSecret, RoleLabel, ROLES, StoreMultiSelect, StoreNames } from '../components/groupd/ui';
import { SelectField, TextField } from '../components/forms';
import { PageHeader } from '../components/PageHeader';
import { Button, ButtonLink, Card, KeyValueList, Notice } from '../components/primitives';
import { useI18n } from '../i18n';
import { screenPath } from '../routes.meta';
import { useSession } from '../session/SessionProvider';

const EXPIRY_DAYS = [1, 3, 7, 14];

export default function UserInvitePage() {
  const { t, fmt, locale } = useI18n();
  const { store, me, timeZone } = useSession();
  const tz = me?.org.timezone ?? timeZone;
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role | ''>('');
  const [storeIds, setStoreIds] = useState<string[]>(store ? [store.id] : []);
  const [days, setDays] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ email: string; url: string; expires_at: string } | null>(null);

  const invite = useMutation(
    (body: { email: string; role: Role; store_ids: string[]; expires_in_days: number }) => endpoints.users.invite(body),
    {
      successMessage: t('Invitation created'),
      onSuccess: (r) => setResult({ email: email.trim(), url: r.accept_url, expires_at: r.expires_at }),
      onError: (e) => {
        if (e.code === 'account_exists') {
          setErrors({ email: apiErrorText(e, locale) });
          return true;
        }
        if (e.status === 422 && Object.keys(e.fieldErrors).length) {
          setErrors(Object.fromEntries(Object.entries(e.fieldErrors).map(([k, c]) => [k, fieldMessage(c, locale) ?? c])));
          return true;
        }
        return false;
      },
    },
  );

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    const e: Record<string, string> = {};
    const trimmed = email.trim();
    if (!trimmed) e.email = t('This field is required.');
    else if (!/^[^@\s]+@[^@\s]+$/.test(trimmed)) e.email = t('Enter a valid email address.');
    if (!role) e.role = t('This field is required.');
    if (role && role !== 'org_admin' && storeIds.length === 0) e.store_ids = t('Choose at least one store.');
    if (!days) e.expires_in_days = t('This field is required.');
    setErrors(e);
    if (Object.keys(e).length) return;
    void invite.run({ email: trimmed, role: role as Role, store_ids: role === 'org_admin' ? [] : storeIds, expires_in_days: Number(days) });
  };

  const reset = () => {
    setResult(null);
    setEmail('');
    setRole('');
    setDays('');
    setErrors({});
    invite.reset();
  };

  return (
    <>
      <PageHeader
        screenId="web-44"
        action={
          <ButtonLink to={screenPath('web-43')} variant="secondary">
            {t('Back to users')}
          </ButtonLink>
        }
      />
      <div className="grid gd-two">
        <Card title={t('Invite a teammate')}>
          {result ? (
            <div className="gd-result">
              <Notice tone="info" title={t('Invitation created for {email}', { email: result.email })}>
                {t('Deliver this link via an approved channel. Email delivery is not configured.')}
              </Notice>
              <OnceSecret
                label={t('Invitation link')}
                value={result.url}
                note={t('Expires {date}', { date: fmt.dateTime(result.expires_at, tz, { seconds: false, withZone: true }) })}
              />
              <div className="action-row">
                <Button variant="secondary" onClick={reset}>
                  {t('Invite another teammate')}
                </Button>
                <ButtonLink to={screenPath('web-43')}>{t('Back to users')}</ButtonLink>
              </div>
            </div>
          ) : (
            <form onSubmit={submit} noValidate>
              <div className="form-grid">
                <TextField label={t('Email')} type="email" autoComplete="off" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} />
                <SelectField
                  label={t('Role')}
                  required
                  placeholder={t('Select a role')}
                  value={role}
                  onChange={(e) => setRole(e.target.value as Role)}
                  options={ROLES.map((r) => ({ value: r, label: t(`role|${r}`) }))}
                  error={errors.role}
                  hint={t('Roles are fixed. See Roles & permissions for what each role can do.')}
                />
              </div>
              {role === 'org_admin' ? (
                <p className="muted small">{t('Organization admins can access every store.')}</p>
              ) : (
                <StoreMultiSelect label={t('Stores')} required value={storeIds} onChange={setStoreIds} error={errors.store_ids} hint={t('The person sees records only for these stores.')} />
              )}
              <SelectField
                label={t('Invitation expiry')}
                required
                placeholder={t('Select how long the link stays valid')}
                value={days}
                onChange={(e) => setDays(e.target.value)}
                options={EXPIRY_DAYS.map((d) => ({ value: String(d), label: t('{n} days', { n: d }) }))}
                error={errors.expires_in_days}
              />
              {invite.error && !errors.email && !(invite.error.status === 422 && Object.keys(invite.error.fieldErrors).length) ? (
                <div className="field-error" role="alert">
                  {apiErrorText(invite.error, locale)}
                </div>
              ) : null}
              <div className="action-row">
                <Button type="submit" pending={invite.pending}>
                  {t('Send invite')}
                </Button>
                <ButtonLink to={screenPath('web-43')} variant="secondary">
                  {t('Cancel')}
                </ButtonLink>
              </div>
            </form>
          )}
        </Card>
        <Card title={t('Review before saving')}>
          <KeyValueList
            items={[
              { label: t('Email'), value: email.trim() || <span className="muted">{t('Not entered')}</span> },
              { label: t('Role'), value: role ? <RoleLabel role={role} /> : <span className="muted">{t('Not selected')}</span> },
              {
                label: t('Stores'),
                value: role === 'org_admin' ? t('All stores (organization admin)') : storeIds.length ? <StoreNames ids={storeIds} /> : <span className="muted">{t('Not selected')}</span>,
              },
              { label: t('Invitation expiry'), value: days ? t('{n} days', { n: Number(days) }) : <span className="muted">{t('Not selected')}</span> },
            ]}
          />
          <Notice tone="info">{t('Email delivery is not configured. After saving, copy the one-time link and deliver it via an approved channel.')}</Notice>
          <p className="muted small">{t('Saved changes appear in the audit log.')}</p>
        </Card>
      </div>
    </>
  );
}
