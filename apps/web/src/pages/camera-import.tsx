// web-13 Bulk camera import. POST /v1/cameras/import {store_id, csv, username?, password?, dry_run}.
//   1. Validate rows (dry_run: true) -> every row with status valid|invalid and its error codes.
//   2. Import valid devices (dry_run: false) is offered only when the validated CSV has no invalid rows:
//      the API imports all rows or none (422 import_has_invalid_rows), so nothing is ever skipped silently.
// The credential group (one read-only account for every row) is sealed to the store edge; the password
// is never echoed and is cleared after each request.
import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { endpoints } from '../api/endpoints';
import { useMutation } from '../api/hooks';
import type { CameraImportResult } from '../api/types';
import { TextAreaField, fieldErrorText } from '../components/forms';
import { CredentialFields } from '../components/groupb/camera-forms';
import { StoreSelect, useScopedStore } from '../components/groupb/ui';
import { PageHeader } from '../components/PageHeader';
import { Badge, Button, ButtonLink, Card, Notice, StatusPill } from '../components/primitives';
import { PermissionDenied } from '../components/states';
import { hasTranslation, useI18n } from '../i18n';
import { screenPath } from '../routes.meta';
import { useSession } from '../session/SessionProvider';
import '../styles/group-b.css';

const MAX_BYTES = 200_000;
const EXAMPLE = 'name,location,address,stream_profile\nCAM-01,Entrance,192.168.10.21,substream\nCAM-02,Cosmetics aisle,192.168.10.22,substream';

type Body = Parameters<typeof endpoints.cameras.import>[0];

export default function CameraImportPage() {
  const { t, locale } = useI18n();
  const { can } = useSession();
  const scoped = useScopedStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [storeId, setStoreId] = useState(scoped.store?.id ?? '');
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [result, setResult] = useState<(CameraImportResult & { dry: boolean; csv: string; storeId: string }) | null>(null);

  const run = useMutation((body: Body) => endpoints.cameras.import(body), {
    successMessage: (r) => (r.created > 0 ? t('{n} cameras imported', { n: r.created }) : t('Validation finished')),
    onError: (e) => {
      setPassword('');
      if (e.status === 422) {
        const fe = e.fieldErrors;
        const lineErrors = Object.entries(fe).filter(([k]) => k.startsWith('line_'));
        if (lineErrors.length && result) {
          // The server re-checked the rows and found problems: show them on the rows, import nothing.
          setResult({
            ...result,
            dry: true,
            rows: result.rows.map((r) => {
              const codes = fe[`line_${r.line}`];
              return codes ? { ...r, status: 'invalid', errors: codes.split(',') } : r;
            }),
          });
        }
        setErrors(
          Object.fromEntries(
            Object.entries(fe)
              .filter(([k]) => !k.startsWith('line_'))
              .map(([k, v]) => [k, fieldErrorText(v, locale)]),
          ),
        );
        return true;
      }
      return false;
    },
  });

  if (!can('camera.manage')) {
    return (
      <>
        <PageHeader screenId="web-13" />
        <PermissionDenied permission="camera.manage" />
      </>
    );
  }

  const check = () => {
    const next: Record<string, string> = {};
    if (!storeId) next.store_id = t('field_error|required');
    if (!csv.trim()) next.csv = t('Paste CSV rows or choose a CSV file.');
    else if (new Blob([csv]).size > MAX_BYTES) next.csv = t('The CSV is larger than 200 KB. Split it into smaller files.');
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const send = async (dry: boolean) => {
    if (!check()) return;
    const body: Body = { store_id: storeId, csv, dry_run: dry };
    if (username || password) {
      body.username = username;
      body.password = password;
    }
    const r = await run.run(body);
    if (r.ok) {
      setResult({ ...r.data, dry, csv, storeId });
      if (!dry) setPassword('');
    }
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > MAX_BYTES) {
      setErrors((x) => ({ ...x, csv: t('The CSV is larger than 200 KB. Split it into smaller files.') }));
      return;
    }
    setCsv(await f.text());
    setFileName(f.name);
    setResult(null);
    setErrors((x) => ({ ...x, csv: null }));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void send(true);
  };

  const stale = result !== null && (result.csv !== csv || result.storeId !== storeId);
  const invalid = result?.rows.filter((r) => r.status === 'invalid').length ?? 0;
  const valid = result?.rows.filter((r) => r.status === 'valid').length ?? 0;
  const canImport = result !== null && result.dry && !stale && invalid === 0 && valid > 0;

  return (
    <>
      <PageHeader screenId="web-13" subtitle={t('Validate every row first. Import runs only when all rows are valid, so no camera is skipped silently.')} />
      <div className="grid gb-form-layout">
        <Card title={t('Bulk camera import')}>
          <form onSubmit={submit} noValidate autoComplete="off">
            <StoreSelect
              value={storeId}
              onChange={(id) => {
                setStoreId(id);
                setErrors((x) => ({ ...x, store_id: null }));
              }}
              error={errors.store_id}
            />
            <div className="field">
              <label className="gb-label" htmlFor="csv-file">
                {t('CSV file')}
              </label>
              <input id="csv-file" ref={fileRef} type="file" accept=".csv,text/csv,text/plain" onChange={(e) => void onFile(e)} />
              {fileName ? <div className="help">{t('Loaded {name}', { name: fileName })}</div> : null}
            </div>
            <TextAreaField
              label={t('CSV rows')}
              required
              rows={8}
              className="gb-csv"
              value={csv}
              onChange={(e) => {
                setCsv(e.target.value);
                setErrors((x) => ({ ...x, csv: null }));
              }}
              error={errors.csv}
              placeholder={EXAMPLE}
              hint={t('Columns: name, location, address, stream_profile (substream or mainstream). A header row is optional. Up to 500 rows.')}
            />
            <h3 className="gb-section-title">{t('Credential group')}</h3>
            <p className="muted small">{t('Optional. One read-only account used for every camera in this file. Requires a paired edge appliance.')}</p>
            <div className="form-grid">
              <CredentialFields username={username} password={password} onUsername={setUsername} onPassword={setPassword} errors={errors} showProfile={false} />
            </div>
            <div className="action-row">
              <Button type="submit" variant={canImport ? 'secondary' : 'primary'} pending={run.pending}>
                {t('Validate rows')}
              </Button>
              {canImport ? (
                <Button onClick={() => void send(false)} pending={run.pending}>
                  {t('Import valid devices')} ({valid})
                </Button>
              ) : null}
            </div>
          </form>
        </Card>
        <Card title={t('Validation results')}>
          <ImportResults result={result} stale={stale} invalid={invalid} valid={valid} />
        </Card>
      </div>
    </>
  );
}

function ImportResults({
  result,
  stale,
  invalid,
  valid,
}: {
  result: (CameraImportResult & { dry: boolean }) | null;
  stale: boolean;
  invalid: number;
  valid: number;
}) {
  const { t, locale } = useI18n();
  if (!result) {
    return <p className="muted">{t('Run “Validate rows” to check every row before anything is imported.')}</p>;
  }
  const errText = (code: string) => (hasTranslation(locale, `importerr|${code}`) || hasTranslation('en', `importerr|${code}`) ? t(`importerr|${code}`) : code);
  return (
    <>
      {stale ? <Notice tone="warning">{t('The CSV or store changed after validation. Validate again before importing.')}</Notice> : null}
      {!result.dry ? (
        <Notice tone="info" title={t('{n} cameras imported', { n: result.created })}>
          {t('Each camera stays “Pending checks” until the store edge verifies its stream.')}{' '}
          <ButtonLink size="sm" to={screenPath('web-14')}>
            {t('Camera inventory')}
          </ButtonLink>
        </Notice>
      ) : invalid > 0 ? (
        <Notice tone="critical" title={t('{n} rows need fixing', { n: invalid })}>
          {t('Nothing is imported while any row is invalid. Fix or remove these rows, then validate again.')}
        </Notice>
      ) : (
        <Notice tone="info">{t('{n} rows are valid and ready to import.', { n: valid })}</Notice>
      )}
      <div className="gb-table-wrap">
        <table className="gb-table">
          <caption className="visually-hidden">{t('Validation results')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('Line')}</th>
              <th scope="col">{t('Camera name')}</th>
              <th scope="col">{t('IP address')}</th>
              <th scope="col">{t('Status')}</th>
              <th scope="col">{t('Problems')}</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((r) => (
              <tr key={r.line} className={r.status === 'invalid' ? 'gb-row-invalid' : undefined}>
                <td>{r.line}</td>
                <td>{r.name || <span className="muted">—</span>}</td>
                <td className="mono">{r.address || '—'}</td>
                <td>
                  {r.status === 'invalid' ? (
                    <StatusPill tone="critical">{t('import|Invalid')}</StatusPill>
                  ) : r.status === 'created' ? (
                    <StatusPill tone="ok">{t('import|Imported')}</StatusPill>
                  ) : (
                    <StatusPill tone="info">{t('import|Valid')}</StatusPill>
                  )}
                </td>
                <td>
                  {r.errors.length === 0 ? (
                    <span className="muted">—</span>
                  ) : (
                    <ul className="plain-list">
                      {r.errors.map((code) => (
                        <li key={code}>
                          <Badge tone="critical">{errText(code)}</Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
