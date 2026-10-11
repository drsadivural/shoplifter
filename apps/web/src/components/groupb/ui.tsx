// Small UI pieces shared by the group B screens (stores, edge, cameras, detection, operations).
import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import type { ChannelState, ChannelStateValue, DetectionChannel, StoreRef } from '../../api/types';
import { useI18n } from '../../i18n';
import { useSession } from '../../session/SessionProvider';
import { SelectField } from '../forms';
import { Card, KeyValueList, StatusPill, type Tone } from '../primitives';
import { ageSeconds, type EdgeCommand } from './api';

/** "Review before saving" summary card used beside the form screens (web-04, 07, 08, 12). */
export function ReviewCard({ items, children }: { items: { label: ReactNode; value: ReactNode }[]; children?: ReactNode }) {
  const { t } = useI18n();
  return (
    <Card title={t('Review before saving')} className="gb-review">
      <KeyValueList items={items} />
      {children}
      <p className="muted small">{t('Saved changes appear in the audit log')}</p>
    </Card>
  );
}

/** Placeholder text for an empty draft value in the review card. */
export function Unset() {
  const { t } = useI18n();
  return <span className="muted">{t('Not entered')}</span>;
}

/**
 * The store a store-scoped screen works on: `?store_id=` when it is one of the user's stores
 * (deep links from store detail), otherwise the store selected in the header.
 */
export function useScopedStore(): { store: StoreRef | undefined; timeZone: string } {
  const [params] = useSearchParams();
  const { stores, store, timeZone } = useSession();
  const requested = params.get('store_id');
  const found = requested ? stores.find((s) => s.id === requested) : undefined;
  return found ? { store: found, timeZone: found.timezone } : { store, timeZone };
}

/** Store selector over the stores the signed-in user can access (session scope). */
export function StoreSelect({
  value,
  onChange,
  label,
  hint,
  error,
  required = true,
  stores: storesProp,
}: {
  value: string;
  onChange: (id: string) => void;
  label?: string;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  stores?: StoreRef[];
}) {
  const { t } = useI18n();
  const { stores: sessionStores } = useSession();
  const stores = storesProp ?? sessionStores;
  return (
    <SelectField
      label={label ?? t('Store')}
      hint={hint}
      error={error}
      required={required}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={t('Select a store')}
      options={stores.map((s) => ({ value: s.id, label: s.name }))}
    />
  );
}

const CHANNEL_STATE: Record<ChannelStateValue, [Tone, string]> = {
  not_requested: ['neutral', 'chstate|Not requested'],
  unavailable: ['neutral', 'chstate|Unavailable'],
  starting: ['info', 'chstate|Starting'],
  running: ['ok', 'chstate|Running'],
  degraded: ['warning', 'chstate|Degraded'],
};

export function channelStateOf(v: ChannelState | ChannelStateValue | undefined): ChannelState {
  if (!v) return { state: 'not_requested' };
  return typeof v === 'string' ? { state: v } : v;
}

export function ChannelStatePill({ value }: { value: ChannelState | ChannelStateValue | undefined }) {
  const { t } = useI18n();
  const s = channelStateOf(value);
  const [tone, key] = CHANNEL_STATE[s.state] ?? CHANNEL_STATE.unavailable;
  return <StatusPill tone={tone}>{t(key)}</StatusPill>;
}

export const DETECTION_CHANNELS: DetectionChannel[] = ['behavior', 'watchlist', 'checkout'];

/** Label key for a detection channel (design terms: Behavior / Watchlist / Checkout). */
export const DETECTION_CHANNEL_LABEL: Record<DetectionChannel, string> = {
  behavior: 'Behavior',
  watchlist: 'Watchlist',
  checkout: 'Checkout',
};

const COMMAND_STATUS: Record<string, [Tone, string]> = {
  queued: ['info', 'cmd|Queued'],
  sent: ['info', 'cmd|Sent to edge'],
  succeeded: ['ok', 'cmd|Succeeded'],
  failed: ['critical', 'cmd|Failed'],
  expired: ['neutral', 'cmd|Expired'],
};

export function CommandStatusPill({ status }: { status: EdgeCommand['status'] }) {
  const { t } = useI18n();
  const [tone, key] = COMMAND_STATUS[status] ?? (['neutral', status] as [Tone, string]);
  return <StatusPill tone={tone}>{t(key)}</StatusPill>;
}

export const COMMAND_KIND_LABEL: Record<string, string> = {
  discover: 'cmdkind|Discovery',
  provision_camera: 'cmdkind|Connection check',
  activate_camera: 'cmdkind|Start analysis',
  pause_camera: 'cmdkind|Pause analysis',
  update_zones: 'cmdkind|Zone update',
  model_rollout: 'cmdkind|Model rollout',
  gallery_update: 'cmdkind|Gallery update',
};

/**
 * Frame freshness from the edge-reported last frame time. Fresh ≤ 30 s, delayed ≤ 120 s,
 * otherwise stale. A missing frame is "No frame received" — never shown as live.
 */
export function FreshnessPill({ at, now }: { at: string | null | undefined; now?: number }) {
  const { t, fmt } = useI18n();
  const age = ageSeconds(at, now);
  if (age === null) return <StatusPill tone="neutral">{t('No frame received')}</StatusPill>;
  const tone: Tone = age <= 30 ? 'ok' : age <= 120 ? 'warning' : 'critical';
  const label = age <= 30 ? t('Fresh') : age <= 120 ? t('Delayed') : t('Stale');
  return (
    <StatusPill tone={tone} title={fmt.relative(at!)}>
      {label} · {fmt.duration(age)}
    </StatusPill>
  );
}

/** Wizard steps for the ONVIF flow (Discover → Authenticate → Readiness → Activate). */
export function WizardSteps({ current }: { current: 1 | 2 | 3 | 4 }) {
  const { t } = useI18n();
  const steps = [t('Discover'), t('Authenticate'), t('Readiness'), t('Activate')];
  return (
    <ol className="gb-steps" aria-label={t('Camera setup steps')}>
      {steps.map((s, i) => (
        <li key={s} className={i + 1 === current ? 'active' : undefined} aria-current={i + 1 === current ? 'step' : undefined}>
          {i + 1} · {s}
        </li>
      ))}
    </ol>
  );
}
