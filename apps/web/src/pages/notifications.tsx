// web-51 Notification settings. Personal: PATCH /v1/me/preferences {notification_prefs} (the full
// object; the server replaces it) for behavior/watchlist/checkout/rfid, sound, quiet hours and
// store routing. Push text is always generic (private_preview is fixed). For policy.manage: the
// store's notification_routing policy (GET/PUT /v1/stores/{id}/policies/notification_routing).
import '../styles/group-d.css';
import { useEffect, useState, type FormEvent } from 'react';
import { endpoints } from '../api/endpoints';
import { useApiQuery, useMutation } from '../api/hooks';
import type { NotificationPrefs } from '../api/types';
import type { NotificationRoutingSettings } from '../components/groupd/api';
import { apiErrorText, fieldMessage, isVersionConflict } from '../components/groupd/errors';
import { StoreMultiSelect } from '../components/groupd/ui';
import { FormField, Select, TextInput, Toggle } from '../components/forms';
import { PageHeader } from '../components/PageHeader';
import { Button, Card, KeyValueList, Notice } from '../components/primitives';
import { RouteStateBoundary } from '../components/RouteStateBoundary';
import { ConflictBanner, UnavailableNotice } from '../components/states';
import { useI18n } from '../i18n';
import { useSession } from '../session/SessionProvider';

const CHANNELS: { key: 'behavior' | 'watchlist' | 'checkout' | 'rfid'; label: string; hint: string }[] = [
  { key: 'behavior', label: 'Behavior alerts', hint: 'Candidate behavior signals that need review.' },
  { key: 'watchlist', label: 'Watchlist alerts', hint: 'Candidate matches against approved profiles. A match is never proof.' },
  { key: 'checkout', label: 'Checkout alerts', hint: 'Visual activity that does not match POS scans.' },
  { key: 'rfid', label: 'RFID alerts', hint: 'Tagged items moving without a matching sale.' },
];

export default function NotificationsPage() {
  const { t } = useI18n();
  const { can } = useSession();
  const health = useApiQuery((signal) => endpoints.health.system({ signal }), [], { enabled: can('health.read') });
  const apns = health.data?.dependencies.apns;
  return (
    <>
      <PageHeader screenId="web-51" />
      {apns && apns !== 'available' ? <UnavailableNotice code="push_unconfigured" /> : null}
      <div className="grid gd-two">
        <PersonalPrefs />
        <div className="gd-stack">
          <Card title={t('Push privacy')}>
            <KeyValueList items={[{ label: t('Lock-screen text'), value: t('Generic text only') }]} />
            <p className="muted small">{t('Notifications never include photos, names, reference IDs or accusations. Open the app to see the alert. This cannot be changed.')}</p>
            <p className="muted small">{t('Acknowledgement is recorded only when a responder presses Acknowledge; delivering a notification never acknowledges an alert.')}</p>
          </Card>
          {can('policy.manage') ? <StoreRouting /> : null}
        </div>
      </div>
    </>
  );
}

function PersonalPrefs() {
  const { t, locale } = useI18n();
  const { me, reload } = useSession();
  const initial = me?.user.notification_prefs;
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(initial ?? null);
  const [quiet, setQuiet] = useState(Boolean(initial?.quiet_hours));
  const [qh, setQh] = useState(initial?.quiet_hours ?? { start: '', end: '' });
  const [routing, setRouting] = useState<'all' | 'selected'>(initial && initial.store_ids.length > 0 ? 'selected' : 'all');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!initial) return;
    setPrefs(initial);
    setQuiet(Boolean(initial.quiet_hours));
    setQh(initial.quiet_hours ?? { start: '', end: '' });
    setRouting(initial.store_ids.length > 0 ? 'selected' : 'all');
  }, [initial]);

  const save = useMutation((p: NotificationPrefs) => endpoints.me.updatePreferences({ notification_prefs: p }), {
    successMessage: t('Notification settings saved'),
    onSuccess: () => reload(),
    onError: (e) => {
      if (e.status === 422 && Object.keys(e.fieldErrors).length) {
        setErrors(Object.fromEntries(Object.entries(e.fieldErrors).map(([k, c]) => [k.replace('notification_prefs.', ''), fieldMessage(c, locale) ?? c])));
        return true;
      }
      return false;
    },
  });

  if (!prefs) return null;
  const set = (k: keyof NotificationPrefs, v: boolean) => setPrefs({ ...prefs, [k]: v });

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    const e: Record<string, string> = {};
    if (quiet && (!/^\d{2}:\d{2}$/.test(qh.start) || !/^\d{2}:\d{2}$/.test(qh.end))) e.quiet_hours = t('Enter both a start and an end time.');
    if (quiet && qh.start === qh.end && qh.start) e.quiet_hours = t('Start and end must be different.');
    if (routing === 'selected' && prefs.store_ids.length === 0) e.store_ids = t('Choose at least one store.');
    setErrors(e);
    if (Object.keys(e).length) return;
    void save.run({
      ...prefs,
      private_preview: true,
      quiet_hours: quiet ? { start: qh.start, end: qh.end } : null,
      store_ids: routing === 'all' ? [] : prefs.store_ids,
    });
  };

  return (
    <Card title={t('Notification settings')}>
      <form onSubmit={submit} noValidate>
        {CHANNELS.map((c) => (
          <Toggle key={c.key} label={t(c.label)} hint={t(c.hint)} checked={prefs[c.key]} onChange={(v) => set(c.key, v)} />
        ))}
        <Toggle label={t('Sound')} hint={t('Play a sound for new alerts in the app.')} checked={prefs.sound} onChange={(v) => set('sound', v)} />
        <Toggle label={t('Quiet hours')} hint={t('No push notifications during these hours. Alerts still appear in the inbox.')} checked={quiet} onChange={setQuiet} />
        {quiet ? (
          <div className="form-grid">
            <FormField label={t('Start')} error={errors.quiet_hours}>
              {(p) => <TextInput {...p} type="time" value={qh.start} onChange={(e) => setQh({ ...qh, start: e.target.value })} />}
            </FormField>
            <FormField label={t('End')}>{(p) => <TextInput {...p} type="time" value={qh.end} onChange={(e) => setQh({ ...qh, end: e.target.value })} />}</FormField>
          </div>
        ) : null}
        <FormField label={t('Store routing')} hint={t('Which of your stores send you notifications.')}>
          {(p) => (
            <Select {...p} value={routing} onChange={(e) => setRouting(e.target.value as 'all' | 'selected')}>
              <option value="all">{t('All my assigned stores')}</option>
              <option value="selected">{t('Only selected stores')}</option>
            </Select>
          )}
        </FormField>
        {routing === 'selected' ? (
          <StoreMultiSelect label={t('Stores')} value={prefs.store_ids} onChange={(ids) => setPrefs({ ...prefs, store_ids: ids })} error={errors.store_ids} />
        ) : null}
        {save.error && !(save.error.status === 422 && Object.keys(save.error.fieldErrors).length) ? (
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
            onClick={() => {
              if (!initial) return;
              setPrefs(initial);
              setQuiet(Boolean(initial.quiet_hours));
              setQh(initial.quiet_hours ?? { start: '', end: '' });
              setRouting(initial.store_ids.length > 0 ? 'selected' : 'all');
              setErrors({});
            }}
          >
            {t('Cancel')}
          </Button>
        </div>
        <p className="muted small">{t('These settings apply only to you. Store policies can turn off alert types for everyone at a store.')}</p>
      </form>
    </Card>
  );
}

function StoreRouting() {
  const { t, locale } = useI18n();
  const { stores, store } = useSession();
  const [storeId, setStoreId] = useState(store?.id ?? stores[0]?.id ?? '');
  const q = useApiQuery((signal) => endpoints.stores.getPolicy<NotificationRoutingSettings>(storeId, 'notification_routing', { signal }), [storeId], {
    enabled: Boolean(storeId),
  });
  const [form, setForm] = useState<NotificationRoutingSettings | null>(null);
  const [conflict, setConflict] = useState(false);
  useEffect(() => {
    if (q.data) setForm(q.data.settings);
  }, [q.data]);
  const save = useMutation(
    (body: { expected_version: number; settings: NotificationRoutingSettings }) =>
      endpoints.stores.putPolicy<NotificationRoutingSettings>(storeId, 'notification_routing', body),
    {
      successMessage: t('Store notification routing saved'),
      onSuccess: (r) => q.setData(r),
      onError: (e) => {
        if (isVersionConflict(e)) {
          setConflict(true);
          q.reload();
          return true;
        }
        return false;
      },
    },
  );
  if (stores.length === 0) return null;
  return (
    <Card title={t('Store notification routing')}>
      <p className="muted small">{t('Alert types pushed to responders at this store. Turning a type off here stops its push notifications for everyone at the store; alerts still appear in the inbox.')}</p>
      <FormField label={t('Store')}>
        {(p) => (
          <Select {...p} value={storeId} onChange={(e) => { setConflict(false); setStoreId(e.target.value); }}>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        )}
      </FormField>
      {conflict ? (
        <ConflictBanner
          currentVersion={q.data?.version}
          reloading={q.fetching}
          onReload={() => {
            setConflict(false);
            q.reload();
          }}
        />
      ) : null}
      <RouteStateBoundary query={q} loading={<p className="muted">{t('Loading…')}</p>}>
        {(d) =>
          form ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void save.run({ expected_version: d.version, settings: form });
              }}
            >
              {CHANNELS.map((c) => (
                <Toggle key={c.key} label={t(c.label)} checked={form[c.key]} onChange={(v) => setForm({ ...form, [c.key]: v })} />
              ))}
              <Toggle label={t('Sound')} checked={form.sound} onChange={(v) => setForm({ ...form, sound: v })} />
              {save.error && !isVersionConflict(save.error) ? (
                <div className="field-error" role="alert">
                  {apiErrorText(save.error, locale)}
                </div>
              ) : null}
              <div className="action-row">
                <Button type="submit" pending={save.pending}>
                  {t('Save store routing')}
                </Button>
              </div>
              <p className="muted small">
                {d.version === 0 ? t('Defaults — not saved yet') : t('Version {n}', { n: d.version })} · {t('Changes are recorded in the audit log.')}
              </p>
            </form>
          ) : null
        }
      </RouteStateBoundary>
      <Notice tone="info">{t('Escalation recipients and acknowledgement deadlines are set in the escalation policy.')}</Notice>
    </Card>
  );
}
