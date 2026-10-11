// web-52 Support & diagnostics. POST /v1/support/bundles {category, store_id?, consent: true,
// description} -> redacted diagnostics bundle (download via authenticated /v1/media/{id}, expires
// in 7 days). Lists what the bundle excludes; shows the support contact from GET /v1/auth/config.
import '../styles/group-d.css';
import { useState, type FormEvent } from 'react';
import { endpoints } from '../api/endpoints';
import { useApiQuery, useMutation } from '../api/hooks';
import { gd, type SupportBundleD } from '../components/groupd/api';
import { apiErrorText, fieldMessage } from '../components/groupd/errors';
import { Checkbox, SelectField, TextAreaField } from '../components/forms';
import { PageHeader } from '../components/PageHeader';
import { Button, Card, KeyValueList, Notice } from '../components/primitives';
import { useI18n } from '../i18n';
import { useSession } from '../session/SessionProvider';

const CATEGORIES: { value: string; label: string }[] = [
  { value: 'camera', label: 'Camera issue' },
  { value: 'detection', label: 'support|Detection or alert quality' },
  { value: 'notification', label: 'Notification issue' },
  { value: 'sign_in', label: 'support|Sign-in or access' },
  { value: 'edge', label: 'support|Store edge appliance' },
  { value: 'other', label: 'support|Something else' },
];

const EXCLUDED = [
  'Camera credentials and stream addresses',
  'Face templates and reference photos',
  'Evidence clips, frames and snapshots',
  'Session, MFA and push tokens',
  'Personal details of shoppers or staff',
];

export default function SupportPage() {
  const { t, fmt, locale } = useI18n();
  const { stores, store, me, timeZone } = useSession();
  const tz = me?.org.timezone ?? timeZone;
  const cfg = useApiQuery((signal) => endpoints.auth.config({ signal }), []);
  const [category, setCategory] = useState('');
  const [storeId, setStoreId] = useState(store?.id ?? '');
  const [consent, setConsent] = useState(false);
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [bundle, setBundle] = useState<SupportBundleD | null>(null);

  const create = useMutation((body: { category: string; store_id?: string; consent: true; description: string }) => gd.support.createBundle(body), {
    successMessage: t('Diagnostic bundle generated'),
    onSuccess: setBundle,
    onError: (e) => {
      if (e.status === 422 && Object.keys(e.fieldErrors).length) {
        setErrors(Object.fromEntries(Object.entries(e.fieldErrors).map(([k, c]) => [k, fieldMessage(c, locale) ?? c])));
        return true;
      }
      return false;
    },
  });

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    const e: Record<string, string> = {};
    if (!category) e.category = t('This field is required.');
    if (!consent) e.consent = t('Consent is required to generate diagnostics.');
    if (!description.trim()) e.description = t('This field is required.');
    setErrors(e);
    if (Object.keys(e).length) return;
    // The draft stays in the form after a failed request; useMutation blocks duplicate submits.
    void create.run({ category, store_id: storeId || undefined, consent: true, description: description.trim() });
  };

  const contact = bundle?.support_contact ?? cfg.data?.support_contact ?? null;
  const catLabel = (v: string) => t(CATEGORIES.find((c) => c.value === v)?.label ?? v);

  return (
    <>
      <PageHeader screenId="web-52" />
      <div className="grid gd-two">
        <Card title={t('Support & diagnostics')}>
          {bundle ? (
            <div className="gd-result" role="status">
              <Notice tone="info" title={t('Diagnostic bundle generated')}>
                {t('The bundle is redacted and expires {date}. Only you and organization admins can download it.', {
                  date: fmt.dateTime(bundle.expires_at, tz, { seconds: false, withZone: true }),
                })}
              </Notice>
              <p>
                <a className="btn btn-primary btn-md" href={bundle.download_url} download>
                  {t('Download redacted bundle')}
                </a>
              </p>
              <p className="muted small">
                {t('Reference')}: <span className="mono">{bundle.id}</span>
              </p>
              <p className="small">
                {contact ? t('Send the bundle and the reference to {contact}.', { contact }) : t('No support contact is configured for this deployment. Share the bundle with your administrator.')}
              </p>
              <Button
                variant="secondary"
                onClick={() => {
                  setBundle(null);
                  setCategory('');
                  setDescription('');
                  setConsent(false);
                  create.reset();
                }}
              >
                {t('Report another issue')}
              </Button>
            </div>
          ) : (
            <form onSubmit={submit} noValidate>
              <div className="form-grid">
                <SelectField
                  label={t('Issue category')}
                  required
                  placeholder={t('Select a category')}
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  options={CATEGORIES.map((c) => ({ value: c.value, label: t(c.label) }))}
                  error={errors.category}
                />
                <SelectField
                  label={t('Affected store')}
                  value={storeId}
                  onChange={(e) => setStoreId(e.target.value)}
                  options={[{ value: '', label: t('All my stores') }, ...stores.map((s) => ({ value: s.id, label: s.name }))]}
                  error={errors.store_id}
                />
              </div>
              <TextAreaField
                label={t('Description')}
                required
                maxLength={4000}
                placeholder={t('Describe the observed issue')}
                hint={t('What happened, when (store time), and what you expected. Do not include personal details of shoppers or staff.')}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                error={errors.description}
              />
              <div className={`field ${errors.consent ? 'field-invalid' : ''}`}>
                <div className="gd-label">
                  {t('Diagnostics consent')}
                  <span className="required-marker" aria-hidden="true">
                    {' '}
                    *
                  </span>
                </div>
                <Checkbox
                  label={t('I consent to generating a redacted diagnostic bundle of system health, camera status and recent errors for these stores.')}
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  aria-invalid={errors.consent ? true : undefined}
                />
                {errors.consent ? (
                  <div className="field-error">
                    <span aria-hidden="true">▲ </span>
                    {errors.consent}
                  </div>
                ) : null}
              </div>
              {create.error && !(create.error.status === 422 && Object.keys(create.error.fieldErrors).length) ? (
                <div className="field-error" role="alert">
                  {apiErrorText(create.error, locale)}
                </div>
              ) : null}
              <div className="action-row">
                <Button type="submit" pending={create.pending}>
                  {t('Generate diagnostic bundle')}
                </Button>
              </div>
            </form>
          )}
        </Card>
        <div className="gd-stack">
          <Card title={t('Review before saving')}>
            <KeyValueList
              items={[
                { label: t('Issue category'), value: category ? catLabel(category) : <span className="muted">{t('Not selected')}</span> },
                { label: t('Affected store'), value: storeId ? (stores.find((s) => s.id === storeId)?.name ?? '—') : t('All my stores') },
                { label: t('Diagnostics consent'), value: consent ? t('Given') : <span className="muted">{t('Not given')}</span> },
              ]}
            />
            <h3 className="gd-subhead">{t('Never included in the bundle')}</h3>
            <ul className="plain-list gd-excluded">
              {EXCLUDED.map((x) => (
                <li key={x}>
                  <span aria-hidden="true">✕ </span>
                  {t(x)}
                </li>
              ))}
            </ul>
            <p className="muted small">{t('Included: system health, camera readiness and analysis states, and the most recent failed or denied actions (without personal details).')}</p>
          </Card>
          <Card title={t('Support contact')}>
            {cfg.data ? (
              cfg.data.support_contact ? (
                <p className="mono gd-break">{cfg.data.support_contact}</p>
              ) : (
                <p className="muted">{t('No support contact is configured for this deployment. Contact your organization administrator.')}</p>
              )
            ) : cfg.error ? (
              <p className="muted">{t('The support contact could not be loaded.')}</p>
            ) : (
              <p className="muted">{t('Loading…')}</p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
