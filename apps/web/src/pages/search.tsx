// web-35 Historical search.
//   Metadata search: the form builds query params (dates entered in the store timezone, sent as UTC)
//   and opens web-36, which calls GET /v1/search and shows coverage gaps.
//   Reference photo: POST /v1/search/photo (multipart). Without the licensed face SDK the API
//   answers 503 face_sdk_unavailable after checking and discarding the photo; quality failures are 422.
//   Results would only ever be candidates for human review.
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import type { ApiError } from '../api/client';
import { endpoints } from '../api/endpoints';
import { toApiError, useApiQuery } from '../api/hooks';
import { CHANNEL_LABEL } from '../components/domain';
import { FormField, SelectField, TextInput } from '../components/forms';
import { CHANNELS, EVIDENCE_KEY, OUTCOME_KEY, OUTCOMES } from '../components/groupc/labels';
import { useStoreTimeZone } from '../components/groupc/misc';
import { utcToZonedInput, zonedToUtcIso } from '../components/groupc/time';
import { precheckPhoto } from '../components/media';
import { PageHeader } from '../components/PageHeader';
import { Button, ButtonLink, Card, Notice } from '../components/primitives';
import { ErrorState, PermissionDenied, UnavailableNotice } from '../components/states';
import { useI18n } from '../i18n';
import { formatBytes } from '../lib/format';
import { screenPath } from '../routes.meta';
import { useSession } from '../session/SessionProvider';
import { gc } from './_groupc-api';
import '../styles/group-c.css';


export default function SearchPage() {
  const { t } = useI18n();
  const { can } = useSession();
  if (!can('search.metadata')) {
    return (
      <>
        <PageHeader screenId="web-35" />
        <PermissionDenied permission="search.metadata" />
      </>
    );
  }
  return (
    <>
      <PageHeader screenId="web-35" />
      <div className="grid detail-grid">
        <MetadataSearch />
        <div className="gc-stack">
          {can('search.photo') ? <PhotoSearch /> : null}
          <Card title={t('What search covers')}>
            <p className="small">
              {t('Search finds retained incident records. It cannot find anything from before a camera was activated, during camera outages or beyond the evidence retention period — the results page lists those gaps.')}
            </p>
            <p className="small">{t('Every search is recorded in the audit log with its filters.')}</p>
          </Card>
        </div>
      </div>
    </>
  );
}

function MetadataSearch() {
  const { t } = useI18n();
  const { stores, me, timeZone } = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const tzFor = useStoreTimeZone();
  const initialStore = stores.some((s) => s.id === params.get('store_id')) ? params.get('store_id')! : '';
  const [storeId, setStoreId] = useState(initialStore);
  const tz = storeId ? tzFor(storeId) : me?.org.timezone ?? timeZone;
  const now = useMemo(() => new Date(), []);
  const [from, setFrom] = useState(() =>
    params.get('from') ? utcToZonedInput(params.get('from')!, tz) : utcToZonedInput(new Date(now.getTime() - 7 * 86400_000), tz),
  );
  const [to, setTo] = useState(() => (params.get('to') ? utcToZonedInput(params.get('to')!, tz) : ''));
  const [cameraId, setCameraId] = useState(params.get('camera_id') ?? '');
  const [channel, setChannel] = useState((CHANNELS as string[]).includes(params.get('channel') ?? '') ? params.get('channel')! : '');
  const [outcome, setOutcome] = useState(params.get('outcome') ?? '');
  const [assignee, setAssignee] = useState(params.get('assignee') ?? '');
  const [evidence, setEvidence] = useState(params.get('evidence_state') ?? '');
  const [submitted, setSubmitted] = useState(false);
  const cameras = useApiQuery((signal) => endpoints.cameras.list({ store_id: storeId, limit: 100 }, { signal }), [storeId], {
    enabled: Boolean(storeId),
  });

  const fromUtc = from ? zonedToUtcIso(from, tz) : null;
  const toUtc = to ? zonedToUtcIso(to, tz) : null;
  const rangeError = from && to && fromUtc && toUtc && fromUtc >= toUtc ? t('The start must be before the end.') : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (rangeError) return;
    const q = new URLSearchParams();
    if (fromUtc) q.set('from', fromUtc);
    if (toUtc) q.set('to', toUtc);
    if (storeId) q.set('store_id', storeId);
    if (storeId && cameraId) q.set('camera_id', cameraId);
    if (channel) q.set('channel', channel);
    if (outcome) q.set('outcome', outcome);
    if (assignee) q.set('assignee', assignee);
    if (evidence) q.set('evidence_state', evidence);
    navigate(`${screenPath('web-36')}?${q.toString()}`);
  };

  return (
    <Card title={t('Search records')}>
      <form onSubmit={submit} noValidate className="gc-form">
        <div className="form-grid">
          <FormField label={t('From')} hint={t('Store time ({tz})', { tz })} error={submitted ? rangeError : null}>
            {(p) => <TextInput {...p} type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />}
          </FormField>
          <FormField label={t('To')} hint={t('Leave blank for now')}>
            {(p) => <TextInput {...p} type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />}
          </FormField>
        </div>
        <SelectField
          label={t('Store')}
          value={storeId}
          onChange={(e) => {
            setStoreId(e.target.value);
            setCameraId('');
          }}
          options={[{ value: '', label: t('All my stores') }, ...stores.map((s) => ({ value: s.id, label: s.name }))]}
        />
        {storeId ? (
          cameras.error ? (
            <ErrorState error={cameras.error} onRetry={cameras.reload} compact title={t('Cameras could not be loaded')} />
          ) : (
            <SelectField
              label={t('Camera')}
              value={cameraId}
              onChange={(e) => setCameraId(e.target.value)}
              options={[
                { value: '', label: cameras.loading ? t('Loading…') : t('Any camera') },
                ...(cameras.data?.items ?? []).map((c) => ({ value: c.id, label: `${c.name}${c.location ? ` · ${c.location}` : ''}` })),
              ]}
            />
          )
        ) : (
          <p className="help">{t('Choose a store to filter by camera.')}</p>
        )}
        <div className="form-grid">
          <SelectField
            label={t('Event type')}
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            options={[{ value: '', label: t('All types') }, ...CHANNELS.map((c) => ({ value: c, label: t(CHANNEL_LABEL[c]) }))]}
          />
          <SelectField
            label={t('Outcome')}
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            options={[
              { value: '', label: t('Any outcome') },
              { value: 'none', label: t('outcome|Not recorded') },
              ...OUTCOMES.map((o) => ({ value: o, label: t(OUTCOME_KEY[o]) })),
            ]}
          />
          <SelectField
            label={t('Assignee')}
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            options={[
              { value: '', label: t('Anyone') },
              { value: 'me', label: t('Assigned to me') },
              { value: 'none', label: t('Unassigned') },
            ]}
          />
          <SelectField
            label={t('Evidence availability')}
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
            options={[{ value: '', label: t('Any evidence state') }, ...Object.entries(EVIDENCE_KEY).map(([v, k]) => ({ value: v, label: t(k) }))]}
          />
        </div>
        <div className="gc-form-actions">
          <Button type="submit" icon="search">
            {t('Search')}
          </Button>
          <ButtonLink to={screenPath('web-23')}>{t('Open incident register')}</ButtonLink>
        </div>
      </form>
    </Card>
  );
}

const PHOTO_PROBLEM: Record<string, string> = {
  too_dark: 'photo|Too dark',
  overexposed: 'photo|Overexposed',
  blurry: 'photo|Blurry',
  too_small: 'photo|Smaller than 200 × 200 pixels',
  corrupt: 'photo|The file could not be decoded',
  jpeg_or_png_required: 'photo|Only JPEG or PNG',
  required: 'photo|No file was received',
};

function PhotoSearch() {
  const { t, locale } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [precheck, setPrecheck] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [unexpected, setUnexpected] = useState(false);

  const choose = async (f: File | undefined) => {
    setError(null);
    setUnexpected(false);
    setFile(null);
    setPrecheck(null);
    if (!f) return;
    const problem = await precheckPhoto(f, { accept: ['image/jpeg', 'image/png'], maxBytes: 8 * 1024 * 1024, minDimension: 200, maxMegapixels: 40 });
    if (problem) {
      setPrecheck(t(problem.key, problem.vars));
      return;
    }
    setFile(f);
  };

  const run = async (e: FormEvent) => {
    e.preventDefault();
    if (!file || pending) return;
    setPending(true);
    setError(null);
    setUnexpected(false);
    try {
      await gc.photoSearch(file);
      // No deployment returns candidates without the face SDK; never invent a result.
      setUnexpected(true);
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setPending(false);
      setFile(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const problems = error?.status === 422 ? (error.fieldErrors.file ?? '').split(',').filter(Boolean) : [];

  return (
    <Card title={t('Reference photo')}>
      <p className="small">
        {t('Optional. A reference photo is checked for quality and kept only temporarily. Any match is a candidate that a person must review — never an identification.')}
      </p>
      <form onSubmit={run} noValidate>
        <FormField label={t('Photo file')} hint={t('JPEG or PNG, up to {max}, at least {min} × {min} px.', { max: formatBytes(8 * 1024 * 1024, locale), min: 200 })} error={precheck}>
          {(p) => <TextInput {...p} ref={inputRef} type="file" accept="image/jpeg,image/png" onChange={(e) => void choose(e.target.files?.[0])} />}
        </FormField>
        {file ? (
          <div className="gc-form-actions">
            <Button type="submit" pending={pending} icon="search">
              {t('Search by photo')}
            </Button>
          </div>
        ) : null}
      </form>
      {error ? (
        error.status === 503 ? (
          <UnavailableNotice
            code={error.code}
            title={error.code === 'face_index_unavailable' ? t('No face index has been built yet') : undefined}
          >
            {error.code === 'face_sdk_unavailable'
              ? t('Photo search needs the licensed Ayonix face SDK, which is not installed in this deployment. Your photo was checked and discarded; nothing was stored. Use the metadata search instead.')
              : error.code === 'face_index_unavailable'
                ? t('Photo search will be possible after a compatible face index has been built for your stores.')
                : undefined}
          </UnavailableNotice>
        ) : error.status === 422 ? (
          <div className="field-error" role="alert">
            {error.code === 'query_photo_quality' ? t('The photo failed the quality check:') : t('The photo was not accepted:')}{' '}
            {problems.length > 0 ? problems.map((p) => (PHOTO_PROBLEM[p] ? t(PHOTO_PROBLEM[p]) : p)).join(', ') : error.message}
            {error.requestId ? <span className="mono small"> · {t('Request ID')}: {error.requestId}</span> : null}
          </div>
        ) : error.status === 413 ? (
          <div className="field-error" role="alert">
            {t('The file is too large.')}
          </div>
        ) : (
          <ErrorState error={error} compact />
        )
      ) : null}
      {unexpected ? <Notice tone="info">{t('The photo was accepted, but this console cannot display photo-search candidates yet.')}</Notice> : null}
      <p className="muted small">{t('Photo searches are recorded in the audit log, including attempts that could not run.')}</p>
    </Card>
  );
}

