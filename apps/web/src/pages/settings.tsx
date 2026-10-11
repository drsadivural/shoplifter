// web-49 Organization settings. Personal: display language + appearance (PATCH /v1/me/preferences
// via the session) and active sessions (GET/DELETE /v1/me/sessions). Organization (org.manage):
// GET/PUT /v1/org/settings/general {expected_version, settings}. Timezone and retention are shown
// with links to the screens that own them.
import '../styles/group-d.css';
import { useEffect, useState, type FormEvent } from 'react';
import { endpoints } from '../api/endpoints';
import { useApiQuery, useMutation } from '../api/hooks';
import type { Locale, SessionInfo, ThemePreference } from '../api/types';
import { gd, type GeneralSettingsD } from '../components/groupd/api';
import { apiErrorText, fieldMessage, isVersionConflict } from '../components/groupd/errors';
import { SelectField, TextField } from '../components/forms';
import { ConfirmDialog } from '../components/Modal';
import { PageHeader } from '../components/PageHeader';
import { Badge, Button, ButtonLink, Card, FilterTabs, KeyValueList, Notice } from '../components/primitives';
import { RouteStateBoundary } from '../components/RouteStateBoundary';
import { ConflictBanner, EmptyState } from '../components/states';
import { useToast } from '../components/Toast';
import { useI18n } from '../i18n';
import { useTheme } from '../lib/theme';
import { screenPath } from '../routes.meta';
import { useSession } from '../session/SessionProvider';

export default function SettingsPage() {
  const { t } = useI18n();
  const { can } = useSession();
  return (
    <>
      <PageHeader screenId="web-49" />
      <div className="grid gd-two">
        <div className="gd-stack">
          <PersonalPreferences />
          <SessionsCard />
        </div>
        <div className="gd-stack">
          <OrgGeneral />
          <ScopeCard />
          {!can('org.manage') ? <Notice tone="info">{t('Organization-wide settings are managed by organization admins. Your language and appearance apply only to you.')}</Notice> : null}
        </div>
      </div>
    </>
  );
}

function PersonalPreferences() {
  const { t, locale } = useI18n();
  const { savePreferences } = useSession();
  const { preference } = useTheme();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const save = async (p: { locale?: Locale; theme?: ThemePreference }) => {
    setSaving(true);
    try {
      await savePreferences(p);
      toast.show({ tone: 'success', message: t('Preference saved') });
    } catch (e) {
      const err = e as { requestId?: string | null; message?: string };
      toast.show({ tone: 'error', message: t('The preference could not be saved to your account. It applies in this browser only.'), requestId: err.requestId ?? undefined });
    } finally {
      setSaving(false);
    }
  };
  return (
    <Card title={t('Your preferences')} titleAddon={saving ? <Badge tone="info">{t('Saving…')}</Badge> : null}>
      <div className="gd-pref">
        <div>
          <div className="gd-label">{t('Display language')}</div>
          <p className="muted small">{t('Saved to your account and used on every device you sign in to.')}</p>
        </div>
        <FilterTabs<Locale>
          label={t('Display language')}
          value={locale}
          onChange={(l) => void save({ locale: l })}
          items={[
            { value: 'ja', label: '日本語' },
            { value: 'en', label: 'English' },
          ]}
        />
      </div>
      <div className="gd-pref">
        <div>
          <div className="gd-label">{t('Appearance')}</div>
          <p className="muted small">{t('Match system follows your device’s light or dark setting.')}</p>
        </div>
        <FilterTabs<ThemePreference>
          label={t('Appearance')}
          value={preference}
          onChange={(th) => void save({ theme: th })}
          items={[
            { value: 'light', label: t('Light') },
            { value: 'dark', label: t('Dark') },
            { value: 'system', label: t('Match system') },
          ]}
        />
      </div>
    </Card>
  );
}

function SessionsCard() {
  const { t, fmt } = useI18n();
  const { me, timeZone, signOut } = useSession();
  const tz = me?.org.timezone ?? timeZone;
  const q = useApiQuery((signal) => endpoints.me.sessions({ signal }), []);
  const [target, setTarget] = useState<SessionInfo | null>(null);
  const revoke = useMutation((s: SessionInfo) => endpoints.me.revokeSession(s.id), {
    successMessage: t('Session signed out'),
    onSuccess: () => {
      if (target?.current) void signOut();
      else q.reload();
    },
  });
  return (
    <Card title={t('Active sessions')}>
      <RouteStateBoundary query={q} isEmpty={(d) => d.items.length === 0} empty={<EmptyState compact title={t('No active sessions')} />} loading={<p className="muted">{t('Loading…')}</p>}>
        {(d) => (
          <ul className="rows">
            {d.items.map((s) => (
              <li className="row" key={s.id}>
                <div className="row-main">
                  <strong>{s.client === 'ios' ? t('iPhone app') : t('Web browser')}</strong>{' '}
                  {s.current ? <Badge tone="ok">{t('This session')}</Badge> : null}
                  <div className="muted small gd-clamp" title={s.user_agent}>
                    {s.user_agent || t('Unknown device')}
                  </div>
                  <div className="muted small">
                    {t('Signed in {at}', { at: fmt.dateTime(s.created_at, tz, { seconds: false, withZone: true }) })} ·{' '}
                    {t('Last active {at}', { at: fmt.relative(s.last_seen_at) })} · {t('Expires {date}', { date: fmt.dateTime(s.expires_at, tz, { seconds: false, withZone: true }) })}
                  </div>
                </div>
                <Button size="sm" variant="secondary" onClick={() => setTarget(s)}>
                  {s.current ? t('Sign out') : t('Revoke')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </RouteStateBoundary>
      <ConfirmDialog
        open={target !== null}
        onClose={() => setTarget(null)}
        title={target?.current ? t('Sign out this session?') : t('Revoke session?')}
        description={target?.current ? t('You will be signed out of this browser.') : t('That browser or device is signed out immediately.')}
        confirmLabel={target?.current ? t('Sign out') : t('Revoke')}
        confirmVariant="danger"
        requireReason={false}
        pending={revoke.pending}
        onConfirm={async () => (target ? (await revoke.run(target)).ok : false)}
      />
    </Card>
  );
}

function OrgGeneral() {
  const { t, locale } = useI18n();
  const { can } = useSession();
  const editable = can('org.manage');
  const q = useApiQuery((signal) => gd.org.getGeneral({ signal }), []);
  const [form, setForm] = useState<{ default_locale: string; session_timeout_minutes: string; currency: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState(false);
  const data = q.data;

  useEffect(() => {
    if (data) setForm({ default_locale: data.settings.default_locale, session_timeout_minutes: String(data.settings.session_timeout_minutes), currency: data.settings.currency });
  }, [data]);

  const save = useMutation(
    (body: { expected_version: number; settings: GeneralSettingsD }) => gd.org.putGeneral(body),
    {
      successMessage: t('Organization settings saved'),
      onSuccess: (r) => q.setData(r),
      onError: (e) => {
        if (isVersionConflict(e)) {
          setConflict(true);
          q.reload();
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
    if (!form || !data) return;
    const minutes = Number(form.session_timeout_minutes);
    const e: Record<string, string> = {};
    if (!Number.isInteger(minutes) || minutes < 5 || minutes > 1440) e.session_timeout_minutes = t('Enter a whole number from {min} to {max}.', { min: 5, max: 1440 });
    setErrors(e);
    if (Object.keys(e).length) return;
    void save.run({
      expected_version: data.version,
      settings: { default_locale: form.default_locale as GeneralSettingsD['default_locale'], session_timeout_minutes: minutes, currency: form.currency as GeneralSettingsD['currency'] },
    });
  };

  const localeLabel = (v: string) => (v === 'browser' ? t('Follow each browser’s language') : v === 'ja' ? '日本語' : 'English');

  return (
    <Card title={t('Organization settings')}>
      {conflict ? (
        <ConflictBanner
          currentVersion={data?.version}
          reloading={q.fetching}
          onReload={() => {
            setConflict(false);
            q.reload();
          }}
        />
      ) : null}
      <RouteStateBoundary query={q} loading={<p className="muted">{t('Loading…')}</p>}>
        {(d) =>
          editable && form ? (
            <form onSubmit={submit} noValidate>
              <SelectField
                label={t('Default language')}
                hint={t('Used before a person chooses a language. Each person’s own choice always wins.')}
                value={form.default_locale}
                onChange={(e) => setForm({ ...form, default_locale: e.target.value })}
                options={['browser', 'ja', 'en'].map((v) => ({ value: v, label: localeLabel(v) }))}
                error={errors['default_locale'] ?? errors['settings.default_locale']}
              />
              <TextField
                label={t('Session timeout')}
                hint={t('Minutes of inactivity before sign-in is required again (5–1440). Applies to new sessions.')}
                type="number"
                inputMode="numeric"
                min={5}
                max={1440}
                required
                value={form.session_timeout_minutes}
                onChange={(e) => setForm({ ...form, session_timeout_minutes: e.target.value })}
                error={errors.session_timeout_minutes ?? errors['settings.session_timeout_minutes']}
              />
              <SelectField
                label={t('Currency')}
                hint={t('Used for loss and recovered values in reports.')}
                value={form.currency}
                onChange={(e) => setForm({ ...form, currency: e.target.value })}
                options={['JPY', 'USD', 'EUR'].map((c) => ({ value: c, label: c }))}
                error={errors.currency ?? errors['settings.currency']}
              />
              {save.error && !isVersionConflict(save.error) && !(save.error.status === 422 && Object.keys(save.error.fieldErrors).length) ? (
                <div className="field-error" role="alert">
                  {apiErrorText(save.error, locale)}
                </div>
              ) : null}
              <div className="action-row">
                <Button type="submit" pending={save.pending}>
                  {t('Save')}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() =>
                    setForm({ default_locale: d.settings.default_locale, session_timeout_minutes: String(d.settings.session_timeout_minutes), currency: d.settings.currency })
                  }
                >
                  {t('Cancel')}
                </Button>
              </div>
              <p className="muted small">
                {d.version === 0 ? t('Defaults — not saved yet') : t('Version {n}', { n: d.version })} · {t('Changes are recorded in the audit log.')}
              </p>
            </form>
          ) : (
            <KeyValueList
              items={[
                { label: t('Default language'), value: localeLabel(d.settings.default_locale) },
                { label: t('Session timeout'), value: t('{n} minutes', { n: d.settings.session_timeout_minutes }) },
                { label: t('Currency'), value: d.settings.currency },
              ]}
            />
          )
        }
      </RouteStateBoundary>
    </Card>
  );
}

function ScopeCard() {
  const { t } = useI18n();
  const { can, me } = useSession();
  const privacy = useApiQuery((signal) => endpoints.org.getSettings('privacy', { signal }), []);
  return (
    <Card title={t('Configuration scope')}>
      <KeyValueList
        items={[
          { label: t('Organization'), value: me?.org.name ?? '—' },
          {
            label: t('Timezone'),
            value: (
              <span>
                {me?.org.timezone ?? '—'}
                {can('org.manage') ? (
                  <>
                    {' · '}
                    <ButtonLink to={screenPath('web-04')} variant="ghost" size="sm">
                      {t('Change in organization setup')}
                    </ButtonLink>
                  </>
                ) : null}
              </span>
            ),
          },
          {
            label: t('Retention'),
            value: privacy.data ? (
              <span>
                {t('Raw video {h} h · evidence {d} days', { h: privacy.data.settings.raw_video_retention_hours, d: privacy.data.settings.evidence_retention_days })}
                {can('privacy.manage') ? (
                  <>
                    {' · '}
                    <ButtonLink to={screenPath('web-50')} variant="ghost" size="sm">
                      {t('Retention & privacy')}
                    </ButtonLink>
                  </>
                ) : null}
              </span>
            ) : privacy.error ? (
              <span className="muted">{t('Unavailable')}</span>
            ) : (
              <span className="muted">{t('Loading…')}</span>
            ),
          },
        ]}
      />
      <p className="muted small">{t('Store times are shown in each store’s own timezone.')}</p>
    </Card>
  );
}
