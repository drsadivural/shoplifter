// web-17 Behavior detection rules (store policy kind detection_rules).
//   GET /v1/stores/{id}/policies/detection_rules -> {settings, version, updated_at, updated_by}
//   PUT  … {expected_version, settings} (policy.manage); 409 -> ConflictBanner; 422 -> inline per field.
// The defaults are uncalibrated design starting points: `calibrated` turns true only after a
// calibration is published from reviewed outcomes (web-18). The edge applies the policy on its next sync.
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useApiQuery, useMutation } from '../api/hooks';
import type { StorePolicy } from '../api/types';
import { TextField, Toggle, fieldErrorText } from '../components/forms';
import { gb, type CalibrationSettings, type DetectionRules, type EvidenceGate, type GestureRule } from '../components/groupb/api';
import { StoreSelect, useScopedStore } from '../components/groupb/ui';
import { PageHeader } from '../components/PageHeader';
import { Badge, Button, Card, KeyValueList, Notice } from '../components/primitives';
import { RouteStateBoundary } from '../components/RouteStateBoundary';
import { ConflictBanner, EmptyState, UnavailableNotice } from '../components/states';
import { useI18n } from '../i18n';
import { screenPath } from '../routes.meta';
import { useSession } from '../session/SessionProvider';
import '../styles/group-b.css';

const GESTURES = ['clothing_concealment', 'backpack_gesture', 'personal_bag_gesture', 'shelf_interaction'] as const;
type Gesture = (typeof GESTURES)[number];

const GESTURE_LABEL: Record<Gesture, string> = {
  clothing_concealment: 'Clothing concealment',
  backpack_gesture: 'Backpack gesture',
  personal_bag_gesture: 'Personal bag gesture',
  shelf_interaction: 'Shelf interaction',
};

/** Evidence gate fields with their API bounds (policies.py EvidenceGatePolicy). */
const GATE: { key: keyof EvidenceGate; label: string; hint: string; min: number; max: number; exclusiveMin?: boolean; step: number }[] = [
  { key: 'anomaly_threshold', label: 'Anomaly threshold', hint: 'Pose-sequence anomaly score needed before other evidence is considered (0–1).', min: 0, max: 1, step: 0.01 },
  { key: 'interaction_threshold', label: 'Shelf interaction threshold', hint: 'Hand–shelf interaction score (0–1).', min: 0, max: 1, step: 0.01 },
  { key: 'concealment_threshold', label: 'Concealment threshold', hint: 'Concealment gesture score (0–1).', min: 0, max: 1, step: 0.01 },
  { key: 'visibility_min', label: 'Minimum visibility', hint: 'Share of body keypoints that must be visible (0–1).', min: 0, max: 1, step: 0.01 },
  { key: 'duration_s', label: 'Sustained duration (seconds)', hint: 'How long the evidence must persist (up to 60).', min: 0, max: 60, exclusiveMin: true, step: 0.1 },
  { key: 'max_gap_s', label: 'Maximum gap (seconds)', hint: 'Longest interruption allowed inside the evidence window (up to 10).', min: 0, max: 10, exclusiveMin: true, step: 0.1 },
  { key: 'cooldown_s', label: 'Cooldown (seconds)', hint: 'Minimum time between alerts for the same person track (up to 3600).', min: 0, max: 3600, exclusiveMin: true, step: 1 },
];

type Draft = { gestures: Record<Gesture, { enabled: boolean; seconds: string }>; gate: Record<keyof EvidenceGate, string> };

function toDraft(s: DetectionRules): Draft {
  const gestures = {} as Draft['gestures'];
  for (const g of GESTURES) gestures[g] = { enabled: s[g].enabled, seconds: String(s[g].min_evidence_seconds) };
  const gate = {} as Draft['gate'];
  for (const f of GATE) gate[f.key] = String(s.minimum_evidence[f.key]);
  return { gestures, gate };
}

export default function DetectionRulesPage() {
  const { t } = useI18n();
  const { store, timeZone } = useScopedStore();
  const [storeId, setStoreId] = useState(store?.id ?? '');
  useEffect(() => {
    if (!storeId && store) setStoreId(store.id);
  }, [store, storeId]);
  const { stores } = useSession();
  const current = stores.find((s) => s.id === storeId) ?? store;
  const q = useApiQuery((signal) => gb.policy<DetectionRules>(storeId, 'detection_rules', { signal }), [storeId], { enabled: Boolean(storeId) });
  return (
    <>
      <PageHeader screenId="web-17" subtitle={current ? `${current.name} · ${t('Which behavior signals may raise an alert, and how much evidence they need.')}` : undefined} />
      {!storeId ? (
        <EmptyState icon="info" title={t('No stores assigned')} description={t('Ask an administrator to assign you to a store.')} />
      ) : (
        <RouteStateBoundary query={q} permission="policy.manage">
          {(policy) => (
            <RulesForm
              key={`${storeId}`}
              policy={policy}
              storeId={storeId}
              onStore={setStoreId}
              timeZone={current?.timezone ?? timeZone}
              setPolicy={q.setData}
              reload={q.reload}
              reloading={q.fetching}
            />
          )}
        </RouteStateBoundary>
      )}
    </>
  );
}

function RulesForm({
  policy,
  storeId,
  onStore,
  timeZone,
  setPolicy,
  reload,
  reloading,
}: {
  policy: StorePolicy<DetectionRules>;
  storeId: string;
  onStore: (id: string) => void;
  timeZone: string;
  setPolicy: (p: StorePolicy<DetectionRules>) => void;
  reload: () => void;
  reloading: boolean;
}) {
  const { t, fmt, locale } = useI18n();
  const { can } = useSession();
  const [draft, setDraft] = useState<Draft>(() => toDraft(policy.settings));
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [conflict, setConflict] = useState(false);
  const [base, setBase] = useState(policy.version);
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(policy.settings));
  useEffect(() => {
    if (policy.version !== base && !conflict) {
      setDraft(toDraft(policy.settings));
      setBase(policy.version);
    }
  }, [policy, base, conflict]);
  const health = useApiQuery((signal) => gb.health({ signal }), [], { enabled: can('health.read') });
  // The calibration policy is the source of truth: detection_rules.calibrated is only refreshed when
  // these rules are saved again after a calibration is published.
  const cal = useApiQuery((signal) => gb.policy<CalibrationSettings>(storeId, 'calibration', { signal }), [storeId]);
  const calibrated = cal.data ? cal.data.settings.published : policy.settings.calibrated;
  const modelState = health.data?.dependencies.behavior_model;

  const save = useMutation((body: { expected_version: number; settings: Omit<DetectionRules, 'calibrated'> & { calibrated: boolean } }) => gb.putPolicy(storeId, 'detection_rules', body), {
    successMessage: t('Detection rules saved — the store edge applies them on its next sync'),
    onSuccess: (p) => {
      setPolicy(p);
      setDraft(toDraft(p.settings));
      setBase(p.version);
      setConflict(false);
      setErrors({});
    },
    onError: (e) => {
      if (e.status === 409) {
        setConflict(true);
        reload();
        return true;
      }
      if (e.status === 422) {
        setErrors(Object.fromEntries(Object.entries(e.fieldErrors).map(([k, v]) => [k.replace(/^settings\./, ''), fieldErrorText(v, locale)])));
        return true;
      }
      return false;
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    const settings = { ...policy.settings } as DetectionRules;
    for (const g of GESTURES) {
      const v = Number(draft.gestures[g].seconds);
      if (draft.gestures[g].seconds.trim() === '' || !Number.isFinite(v) || v < 0.5 || v > 30)
        errs[`${g}.min_evidence_seconds`] = t('Enter a number from {min} to {max}.', { min: 0.5, max: 30 });
      settings[g] = { enabled: draft.gestures[g].enabled, min_evidence_seconds: v } as GestureRule;
    }
    const gate = { ...policy.settings.minimum_evidence };
    for (const f of GATE) {
      const raw = draft.gate[f.key];
      const v = Number(raw);
      const low = f.exclusiveMin ? v <= f.min : v < f.min;
      if (raw.trim() === '' || !Number.isFinite(v) || low || v > f.max)
        errs[`minimum_evidence.${f.key}`] = f.exclusiveMin
          ? t('Enter a number greater than {min} and up to {max}.', { min: f.min, max: f.max })
          : t('Enter a number from {min} to {max}.', { min: f.min, max: f.max });
      gate[f.key] = v;
    }
    settings.minimum_evidence = gate;
    setErrors(errs);
    if (Object.keys(errs).length) return;
    void save.run({ expected_version: policy.version, settings });
  };

  const setGesture = (g: Gesture, patch: Partial<Draft['gestures'][Gesture]>) =>
    setDraft((d) => ({ ...d, gestures: { ...d.gestures, [g]: { ...d.gestures[g], ...patch } } }));

  return (
    <>
      {conflict ? (
        <ConflictBanner
          currentVersion={policy.version}
          reloading={reloading}
          onReload={() => {
            setConflict(false);
            setDraft(toDraft(policy.settings));
            setBase(policy.version);
            reload();
          }}
        />
      ) : null}
      {!calibrated ? (
        <Notice tone="warning" title={t('Uncalibrated design defaults')}>
          {t('These values are starting points from the design, not measured for this store. They stay uncalibrated until a calibration is published from reviewed outcomes.')}{' '}
          <Link to={screenPath('web-18', { store_id: storeId })}>{t('Store calibration')}</Link>
        </Notice>
      ) : (
        <Notice tone="info">{t('A calibration has been published for this store. Changing thresholds here departs from the calibrated values.')}</Notice>
      )}
      <div className="grid gb-form-layout">
        <Card title={t('Behavior detection rules')}>
          <form onSubmit={submit} noValidate>
            {GESTURES.map((g) => (
              <div className="gb-rule" key={g}>
                <Toggle
                  label={t(GESTURE_LABEL[g])}
                  checked={draft.gestures[g].enabled}
                  onChange={(v) => setGesture(g, { enabled: v })}
                  hint={draft.gestures[g].enabled ? t('Enabled') : t('Disabled — this gesture never raises an alert')}
                />
                <TextField
                  label={t('Minimum evidence (seconds)')}
                  type="number"
                  inputMode="decimal"
                  min={0.5}
                  max={30}
                  step={0.1}
                  className="gb-number"
                  value={draft.gestures[g].seconds}
                  onChange={(e) => {
                    setGesture(g, { seconds: e.target.value });
                    setErrors((x) => ({ ...x, [`${g}.min_evidence_seconds`]: null }));
                  }}
                  error={errors[`${g}.min_evidence_seconds`]}
                />
              </div>
            ))}
            <h3 className="gb-section-title">{t('Minimum evidence')}</h3>
            <p className="muted small">{t('An alert is raised only when these evidence gates are all met. Values are raw model scores, not probabilities.')}</p>
            <div className="form-grid">
              {GATE.map((f) => (
                <TextField
                  key={f.key}
                  label={t(f.label)}
                  hint={t(f.hint)}
                  type="number"
                  inputMode="decimal"
                  min={f.min}
                  max={f.max}
                  step={f.step}
                  value={draft.gate[f.key]}
                  onChange={(e) => {
                    setDraft((d) => ({ ...d, gate: { ...d.gate, [f.key]: e.target.value } }));
                    setErrors((x) => ({ ...x, [`minimum_evidence.${f.key}`]: null }));
                  }}
                  error={errors[`minimum_evidence.${f.key}`]}
                />
              ))}
            </div>
            <div className="action-row">
              <Button type="submit" pending={save.pending}>
                {t('Save')}
              </Button>
              {dirty ? (
                <Button variant="secondary" onClick={() => setDraft(toDraft(policy.settings))}>
                  {t('Cancel')}
                </Button>
              ) : null}
            </div>
          </form>
        </Card>
        <Card title={t('Configuration scope')}>
          <StoreSelect value={storeId} onChange={onStore} />
          <KeyValueList
            items={[
              { label: t('Applies to'), value: t('All cameras of this store with behavior analysis') },
              { label: t('Version'), value: policy.version === 0 ? <Badge tone="neutral">{t('Never saved — defaults')}</Badge> : policy.version },
              { label: t('Last updated'), value: policy.updated_at ? fmt.dateTime(policy.updated_at, timeZone, { withZone: true }) : t('never') },
              { label: t('Calibration'), value: calibrated ? <Badge tone="ok">{t('Calibrated')}</Badge> : <Badge tone="warning">{t('Uncalibrated')}</Badge> },
            ]}
          />
          {modelState && modelState !== 'available' ? (
            <UnavailableNotice code="model_unavailable">
              {t('No validated behavior model is active. These rules are saved, but no behavior alerts are produced until a model passes validation and is rolled out.')}
            </UnavailableNotice>
          ) : modelState === 'available' ? (
            <Notice tone="info">{t('A validated behavior model is active for this organization.')}</Notice>
          ) : null}
          <p className="muted small">{t('Changes are recorded in the audit log.')}</p>
        </Card>
      </div>
    </>
  );
}
